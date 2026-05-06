# npmscan API

A Next.js application deployable to [Vercel](https://vercel.com) that exposes an API to analyze npm package files for security vulnerabilities via [npmscan.com](https://npmscan.com/analyze).

## How It Works

1. Send a `POST` request to `/api/analyze` with the contents of a `package.json` or `package-lock.json` file as the JSON body.
2. The API uses a headless Chromium browser to navigate to [https://npmscan.com/analyze](https://npmscan.com/analyze), paste your package file, submit it, and wait for the analysis to complete.
3. The analysis results are returned as a JSON response.

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/bobbyaxe74/npmscan)

## API Reference

### `POST /api/analyze`

**Request Body:** The contents of a `package.json` or `package-lock.json` file as a JSON object.

**Example:**

```bash
curl -X POST https://your-deployment.vercel.app/api/analyze \
  -H "Content-Type: application/json" \
  -d @package.json
```

**Success Response:**

```json
{
  "success": true,
  "analysisUrl": "https://npmscan.com/...",
  "title": "npmscan results",
  "results": "...",
  "headings": ["..."],
  "tables": ["..."]
}
```

**Error Response:**

```json
{
  "error": "Failed to analyze package file",
  "details": "..."
}
```

## Running Locally

```bash
npm install
npm run dev
```

Then send a request:

```bash
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d @package.json
```

## Tech Stack

- [Next.js](https://nextjs.org/) — React framework for the API routes and UI
- [Puppeteer Core](https://pptr.dev/) — Headless browser automation
- [@sparticuz/chromium](https://github.com/Sparticuz/chromium) — Chromium binary optimized for serverless environments (Vercel / AWS Lambda)
