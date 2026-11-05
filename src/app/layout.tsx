import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MarketingAgent — your AI marketing team",
  description: "Plan, write and publish on-brand social media and SEO content with one AI agent.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-full flex flex-col">
        <div className="aurora" aria-hidden="true"><span /></div>
        <div className="grid-dots" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
