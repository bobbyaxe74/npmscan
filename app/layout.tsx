import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "npmscan API",
  description: "Analyze npm package files for security vulnerabilities via a simple API call.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
