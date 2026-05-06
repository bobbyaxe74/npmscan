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

    // Find the textarea and paste the package.json content
    // npmscan.com/analyze has a textarea for the package.json content
    const textareaSelector = "textarea";
    await page.waitForSelector(textareaSelector, { timeout: 15_000 });

    // Use evaluate to set the textarea value directly (faster than typing)
    await page.evaluate(
      (selector: string, content: string) => {
        const el = document.querySelector(selector) as HTMLTextAreaElement | null;
        if (el) {
          el.value = content;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      },
      textareaSelector,
      packageContent
    );

    // Find and click the submit/analyze button
    // Try common selectors for the submit button
    const buttonSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button.analyze',
      'button.submit',
    ];

    let buttonClicked = false;
    for (const sel of buttonSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click();
          buttonClicked = true;
          break;
        }
      } catch {
        // try next selector
      }
    }

    // If no specific button found, try clicking any button whose text matches
    if (!buttonClicked) {
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button"));
        const analyzeBtn = buttons.find(
          (b) =>
            b.textContent?.toLowerCase().includes("SCAN FOR VULNERABILITIES") ||
            b.textContent?.toLowerCase().includes("analyz") ||
            b.textContent?.toLowerCase().includes("scan") ||
            b.textContent?.toLowerCase().includes("submit") ||
            b.textContent?.toLowerCase().includes("check")
        );
        if (analyzeBtn) {
          (analyzeBtn as HTMLButtonElement).click();
        } else if (buttons.length > 0) {
          (buttons[0] as HTMLButtonElement).click();
        }
      });
    }

    // Wait for results to appear - poll until results exist or URL changes
    const startTime = Date.now();

    await new Promise<void>((resolve, reject) => {
      const interval = setInterval(async () => {
        try {
          if (Date.now() - startTime > ANALYSIS_TIMEOUT_MS) {
            clearInterval(interval);
            reject(new Error("Analysis timed out waiting for results"));
            return;
          }

          const currentUrl = page.url();
          // npmscan.com redirects to a results page or updates the DOM with results
          const hasResults = await page.evaluate(() => {
            const resultSelectors = [
              ".results",
              ".vulnerabilities",
              ".packages",
              "[data-results]",
              ".scan-results",
              ".report",
              "table",
              ".summary",
            ];
            return resultSelectors.some((sel) => document.querySelector(sel) !== null);
          });

          if (hasResults || currentUrl !== NPMSCAN_URL) {
            clearInterval(interval);
            resolve();
          }
        } catch (err) {
          clearInterval(interval);
          reject(err);
        }
      }, 750);
    });

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
