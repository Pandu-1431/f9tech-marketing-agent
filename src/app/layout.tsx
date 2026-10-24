import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MarketingAgent — AI marketing for every business",
  description: "Plan, write and publish on-brand social media and SEO content with one AI agent.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
