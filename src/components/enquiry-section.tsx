import Link from "next/link";
import type { Brand } from "@/db/schema";

/** The business's public enquiry page and what links and leads did in the last 30 days. */
export function EnquirySection({ brand, url, leads30, clicks30, tracking }: { brand: Brand; url: string; leads30: number; clicks30: number; tracking: boolean }) {
  return (
    <section id="enquiry" className="card space-y-3" data-testid="enquiry-section">
      <div>
        <h2 className="font-semibold">Enquiry page &amp; leads</h2>
        <p className="text-sm text-zinc-600">
          A simple page where people send their name and number to {brand.name}. Put it in your Instagram bio, Telegram description and posts
          (or set it as a campaign&apos;s link). Every enquiry lands in <Link href="/leads" className="underline">Leads</Link>.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded bg-zinc-100 px-2 py-1 text-sm" data-testid="enquiry-url">{url}</code>
        <a href={url} target="_blank" rel="noreferrer" className="btn-secondary">Open</a>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="badge bg-fuchsia-50 text-fuchsia-800">{leads30} leads in 30 days</span>
        <span className="badge bg-sky-50 text-sky-800">{tracking ? `${clicks30} link clicks in 30 days` : "Click counting starts when the app is on a public https address"}</span>
      </div>
    </section>
  );
}
