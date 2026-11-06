import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getBrand } from "@/lib/data";
import { change, headline, isMonth, monthlyReport, previousMonth, type Totals } from "@/lib/report";
import { PLATFORM_LABELS } from "@/lib/platforms";
import { publicUrl } from "@/lib/storage";
import { OBJECTIVES } from "@/agent/director";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const n = (v: number) => v.toLocaleString("en-IN");

function Stat({ label, k, totals, previous }: { label: string; k: keyof Totals; totals: Totals; previous: Totals }) {
  const ch = change(totals[k], previous[k]);
  return (
    <div className="rounded-xl border border-zinc-200 p-3 text-center">
      <p className="text-2xl font-bold">{n(totals[k])}</p>
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      {ch !== null && <p className={`text-xs font-semibold ${ch >= 0 ? "text-emerald-700" : "text-red-600"}`}>{ch >= 0 ? "▲" : "▼"} {Math.abs(ch)}% vs last month</p>}
    </div>
  );
}

/** Monthly report for one business. "Download PDF" = the browser's Save as PDF. */
export default async function ReportPage({ params, searchParams }: { params: Promise<{ brandId: string }>; searchParams: Promise<{ month?: string }> }) {
  const { workspace } = await requireAuth();
  const brand = await getBrand(workspace.id, Number((await params).brandId));
  if (!brand) notFound();
  const sp = await searchParams;
  const month = isMonth(sp.month) ? sp.month : new Date().toISOString().slice(0, 7);
  const r = await monthlyReport(workspace.id, brand, month);
  const goal = brand.marketingGoal;
  const plan = brand.marketingPlan;
  const lastReview = plan?.reviews.at(-1);
  const next = month >= new Date().toISOString().slice(0, 7) ? null : `${month.slice(0, 4)}-${String(Number(month.slice(5)) % 12 + 1).padStart(2, "0")}`.replace(/^(\d{4})-01$/, (_, y) => `${Number(y) + 1}-01`);

  return (
    <div className="mx-auto max-w-4xl space-y-6 bg-white print:max-w-none" data-testid="report">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link href={`/reports/${brand.id}?month=${previousMonth(month)}`} className="btn-secondary">← {monthName(previousMonth(month))}</Link>
        {next && <Link href={`/reports/${brand.id}?month=${next}`} className="btn-secondary">{monthName(next)} →</Link>}
        <span className="ml-auto" />
        <PrintButton />
      </div>

      <header className="flex items-center gap-4 border-b border-zinc-200 pb-4">
        {brand.logoKey && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={publicUrl(brand.logoKey)} alt="" className="h-16 w-16 rounded-xl border border-zinc-100 object-contain" />
        )}
        <div>
          <p className="text-xs uppercase tracking-widest text-zinc-500">Marketing report</p>
          <h1 className="text-2xl font-semibold">{brand.name} · {monthName(month)}</h1>
          {goal && <p className="text-sm text-zinc-600">Goal: {OBJECTIVES.find((o) => o.key === goal.objective)?.label ?? goal.objective}{goal.target ? ` · ${goal.target}` : ""}</p>}
        </div>
      </header>

      <p className="text-base text-zinc-800" data-testid="report-headline">{headline(r)}</p>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Posts published" k="published" totals={r.totals} previous={r.previous} />
        <Stat label="People reached" k="reach" totals={r.totals} previous={r.previous} />
        <Stat label="Engagement" k="engagement" totals={r.totals} previous={r.previous} />
        <Stat label="Video views" k="views" totals={r.totals} previous={r.previous} />
        <Stat label="Link clicks" k="clicks" totals={r.totals} previous={r.previous} />
        <Stat label="New leads" k="leads" totals={r.totals} previous={r.previous} />
        <Stat label="New customers" k="won" totals={r.totals} previous={r.previous} />
      </section>

      {r.best.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold">Best posts</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {r.best.map((b) => (
              <div key={`${b.postId}-${b.platform}`} className="space-y-2 rounded-xl border border-zinc-200 p-3 text-sm" style={{ breakInside: "avoid" }}>
                {b.poster && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={publicUrl(b.poster.storageKey)} alt="" className="aspect-square w-full rounded-lg object-cover" />
                )}
                <p className="font-medium">{b.headline || b.caption.slice(0, 60)}</p>
                <p className="text-xs text-zinc-500">{PLATFORM_LABELS[b.platform] ?? b.platform} · {b.format}</p>
                <p className="text-xs">Reach {n(b.reach)} · Engagement {n(b.engagement)}{b.views ? ` · Views ${n(b.views)}` : ""}</p>
                {b.url && <a href={b.url} className="text-xs text-indigo-700 underline print:hidden" target="_blank" rel="noreferrer">Open post</a>}
              </div>
            ))}
          </div>
        </section>
      )}

      {r.byPlatform.length > 0 && (
        <section className="grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className="mb-2 font-semibold">By channel</h2>
            <table className="w-full text-sm">
              <tbody>
                {r.byPlatform.map((p) => (
                  <tr key={p.platform} className="border-t border-zinc-100">
                    <td className="py-1.5">{PLATFORM_LABELS[p.platform] ?? p.platform}</td>
                    <td className="text-right">{p.published} posts</td>
                    <td className="text-right">{n(p.reach)} reach</td>
                    <td className="text-right">{n(p.engagement)} eng.</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h2 className="mb-2 font-semibold">By format</h2>
            <table className="w-full text-sm">
              <tbody>
                {r.byFormat.map((f) => (
                  <tr key={f.format} className="border-t border-zinc-100">
                    <td className="py-1.5">{f.format}</td>
                    <td className="text-right">{f.published} posts</td>
                    <td className="text-right">{n(f.engagement)} eng.</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(r.learnings.length > 0 || lastReview) && (
        <section className="space-y-2" style={{ breakInside: "avoid" }}>
          <h2 className="font-semibold">What we learned</h2>
          {lastReview && <p className="text-sm text-zinc-700">{lastReview.text}</p>}
          <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700">
            {r.learnings.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </section>
      )}

      {plan && (
        <section className="space-y-2" style={{ breakInside: "avoid" }}>
          <h2 className="font-semibold">Coming next</h2>
          <p className="text-sm text-zinc-700">{plan.summary}</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700">
            {plan.weeks.filter((w) => w.end >= new Date().toISOString().slice(0, 10)).map((w) => (
              <li key={w.start}><b>{w.start.slice(5)}:</b> {w.theme}</li>
            ))}
          </ul>
        </section>
      )}

      <p className="border-t border-zinc-200 pt-3 text-xs text-zinc-400">Made with MarketingAgent · {new Date().toLocaleDateString("en-IN")}</p>
    </div>
  );
}
