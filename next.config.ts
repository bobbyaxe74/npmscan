import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core", "puppeteer"],
  outputFileTracingIncludes: {
    "/api/analyze": [
      "./node_modules/@sparticuz/chromium/**/*",
    ],
  },
};

export default nextConfig;
