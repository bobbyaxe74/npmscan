import { NextRequest, NextResponse } from "next/server";
import { type Browser } from "puppeteer-core";

const NPMSCAN_URL = "https://npmscan.com/analyze";
// Use the serverless Chromium only when actually deployed (e.g. Vercel / AWS Lambda)
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
// Allow up to 60 seconds for the analysis to complete
const ANALYSIS_TIMEOUT_MS = 60_000;
// Minimum content length to consider result text substantial
const MIN_CONTENT_LENGTH = 50;

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

    // Extract meaningful results from the page
    const results = await page.evaluate((minContentLength: number) => {
      const getText = (sel: string) =>
        Array.from(document.querySelectorAll(sel)).map((el) => el.textContent?.trim() ?? "");

      // Capture raw text content from common result containers
      const resultContainers = [
        ".results",
        ".vulnerabilities",
        ".packages",
        ".scan-results",
        ".report",
        ".summary",
        "table",
        "main",
        "#main",
        "#content",
        ".content",
      ];

      let rawContent = "";
      for (const sel of resultContainers) {
        const el = document.querySelector(sel);
        if (el) {
          rawContent = el.textContent?.trim() ?? "";
          if (rawContent.length > minContentLength) break;
        }
      }

      // Also gather all visible text from the body as fallback
      if (!rawContent || rawContent.length < minContentLength) {
        rawContent = document.body.textContent?.trim() ?? "";
      }

      return {
        url: window.location.href,
        title: document.title,
        content: rawContent,
        tables: getText("table"),
        headings: getText("h1, h2, h3"),
      };
    }, MIN_CONTENT_LENGTH);

    return NextResponse.json({
      success: true,
      analysisUrl: results.url,
      title: results.title,
      results: results.content,
      headings: results.headings,
      tables: results.tables,
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
