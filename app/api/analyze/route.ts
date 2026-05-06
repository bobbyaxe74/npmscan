import { NextRequest, NextResponse } from "next/server";
import { type Browser } from "puppeteer-core";

const NPMSCAN_URL = "https://npmscan.com/analyze";
// Use the serverless Chromium only when actually deployed (e.g. Vercel / AWS Lambda)
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
// Allow up to 60 seconds for the analysis to complete
const ANALYSIS_TIMEOUT_MS = 60_000;

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let packageJson: unknown;

  try {
    packageJson = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body. Please send the npm package file contents as JSON." },
      { status: 400 }
    );
  }

  if (!packageJson || typeof packageJson !== "object" || Array.isArray(packageJson)) {
    return NextResponse.json(
      { error: "Request body must be a JSON object representing an npm package file." },
      { status: 400 }
    );
  }

  const packageContent = JSON.stringify(packageJson, null, 2);

  let browser: Browser | null = null;

  try {
    if (IS_SERVERLESS) {
      const chromium = await import("@sparticuz/chromium").then((m) => m.default);
      const puppeteerCore = await import("puppeteer-core").then((m) => m.default);
      browser = await puppeteerCore.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: true,
      });
    } else {
      const puppeteer = await import("puppeteer").then((m) => m.default);
      browser = await puppeteer.launch({ headless: true });
    }

    const page = await browser.newPage();

    // Navigate to npmscan.com/analyze
    await page.goto(NPMSCAN_URL, { waitUntil: "networkidle2", timeout: 30_000 });

    // Wait for the textarea
    await page.waitForSelector("textarea", { timeout: 15_000 });

    // npmscan.com is a React app — must use the native input value setter
    // to trigger React's synthetic event system, otherwise state won't update
    await page.evaluate((content: string) => {
      const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null;
      if (!textarea) throw new Error("Textarea not found");
      // Trigger React's internal setter
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(textarea, content);
      } else {
        textarea.value = content;
      }
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    }, packageContent);

    // Click the "SCAN FOR VULNERABILITIES" button by matching button text
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const btn = buttons.find((b) =>
        b.textContent?.toUpperCase().includes("SCAN")
      ) ?? buttons[0];
      if (btn) (btn as HTMLButtonElement).click();
    });

    // Wait for results — detect when the placeholder text disappears
    // and new result content appears (URL may change or DOM updates in place)
    const initialUrl = page.url();
    await page.waitForFunction(
      (startUrl: string) => {
        // Either the URL changed (redirect to results page)
        if (window.location.href !== startUrl) return true;
        // Or the placeholder "PASTE PACKAGE.JSON TO BEGIN ANALYSIS" is gone
        const bodyText = document.body.innerText ?? "";
        if (!bodyText.includes("PASTE PACKAGE.JSON TO BEGIN ANALYSIS")) return true;
        return false;
      },
      { timeout: ANALYSIS_TIMEOUT_MS, polling: 750 },
      initialUrl
    );

    // Wait a moment for any final renders
    await new Promise((r) => setTimeout(r, 500));

    // Extract structured scan results from the DOM
    const results = await page.evaluate(() => {
      const text = (el: Element | null) => el?.textContent?.trim() ?? "";

      // --- Summary stats ---
      // The page shows e.g. "11", "TOTAL PACKAGES", "0", "VULNERABILITIES", "0", "OUTDATED PACKAGES"
      // These appear as sibling number+label pairs. We grab all number-like spans and their labels.
      const statNumbers = Array.from(document.querySelectorAll("*")).filter((el) => {
        const t = el.textContent?.trim() ?? "";
        return (
          el.children.length === 0 &&
          /^\d+$/.test(t) &&
          parseInt(t) <= 10000
        );
      });

      const summary: Record<string, number> = {};
      statNumbers.forEach((numEl) => {
        const sibling = numEl.nextElementSibling ?? numEl.parentElement?.nextElementSibling;
        const label = sibling?.textContent?.trim().toUpperCase() ?? "";
        if (label.includes("TOTAL")) summary.totalPackages = parseInt(numEl.textContent!);
        if (label.includes("VULNERABILIT")) summary.vulnerabilities = parseInt(numEl.textContent!);
        if (label.includes("OUTDATED")) summary.outdatedPackages = parseInt(numEl.textContent!);
      });

      // --- Overall status (e.g. "ALL CLEAR" or "VULNERABILITIES FOUND") ---
      const bodyText = document.body.innerText;
      let overallStatus = "UNKNOWN";
      if (bodyText.includes("ALL CLEAR")) overallStatus = "ALL CLEAR";
      else if (/VULNERABILIT(Y|IES) FOUND/i.test(bodyText)) overallStatus = "VULNERABILITIES FOUND";
      else if (/HIGH RISK/i.test(bodyText)) overallStatus = "HIGH RISK";

      // --- Per-package results ---
      // Each package row contains the name, version, and a status badge (SAFE / VULNERABLE etc.)
      // We detect by looking for elements whose text matches a semver-like version
      const packages: Array<{
        name: string;
        version: string;
        status: string;
        details: string;
      }> = [];

      // Walk all elements looking for a pattern: package-name block, version block, status block
      const allEls = Array.from(document.querySelectorAll("*"));
      allEls.forEach((el) => {
        if (el.children.length > 0) return;
        const t = el.textContent?.trim() ?? "";
        // Match semver versions like 1.2.3, 16.2.4, 148.0.0
        if (!/^\d+\.\d+(\.\d+)?(-\S+)?$/.test(t)) return;
        const version = t;

        // Name is likely in the previous sibling or parent's previous sibling
        let nameEl: Element | null = el.previousElementSibling;
        if (!nameEl) nameEl = el.parentElement?.previousElementSibling ?? null;
        const name = text(nameEl);

        // Status is likely in the next sibling; may contain both badge + detail text
        let statusEl: Element | null = el.nextElementSibling;
        if (!statusEl) statusEl = el.parentElement?.nextElementSibling ?? null;
        const statusFull = text(statusEl);

        // Split e.g. "SAFENO KNOWN VULNERABILITIES" → status: "SAFE", details: "NO KNOWN VULNERABILITIES"
        const statusMatch = statusFull.match(/^(SAFE|VULNERABLE|CRITICAL|HIGH|MEDIUM|LOW|OUTDATED|UNKNOWN)/i);
        const status = statusMatch ? statusMatch[1].toUpperCase() : statusFull;
        const details = statusMatch ? statusFull.slice(statusMatch[1].length).trim() : "";

        if (name && version && status) {
          packages.push({ name, version, status, details });
        }
      });

      // Deduplicate by name+version
      const seen = new Set<string>();
      const uniquePackages = packages.filter(({ name, version }) => {
        const key = `${name}@${version}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return {
        overallStatus,
        summary,
        packages: uniquePackages,
      };
    });

    return NextResponse.json({
      success: true,
      overallStatus: results.overallStatus,
      summary: results.summary,
      packages: results.packages,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Analysis error:", message);
    return NextResponse.json(
      { error: "Failed to analyze package file", details: message },
      { status: 500 }
    );
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

