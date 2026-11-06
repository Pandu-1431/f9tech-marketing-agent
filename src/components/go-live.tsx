import Link from "next/link";
import type { Brand } from "@/db/schema";
import type { GoLive } from "@/lib/go-live";
import { setAutoApproveAction } from "@/app/actions/director";
import { formatSlot } from "@/lib/schedule";

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold ${done ? "bg-emerald-500 text-white" : "bg-zinc-200 text-zinc-600"}`}>{done ? "✓" : n}</span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className={`font-medium ${done ? "text-emerald-800" : ""}`}>{title}</p>
        <div className="text-sm text-zinc-600">{children}</div>
      </div>
    </li>
  );
}

/** The 5 steps from "new business" to "posts going out by themselves". */
export function GoLiveChecklist({ brand, s, compact = false, canEdit = true }: { brand: Brand; s: GoLive; compact?: boolean; canEdit?: boolean }) {
  const live = s.done === 5;
  return (
    <section id={compact ? undefined : "go-live"} className={`card scroll-mt-32 space-y-3 ${live ? "border-emerald-200" : "border-indigo-200"}`} data-testid="go-live">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{live ? "🎉 Live" : "Go live"}{compact ? `: ${brand.name}` : ""}</h2>
        <span className="badge bg-zinc-100 text-zinc-700">{s.done} of 5</span>
        <div className="h-2 min-w-[120px] flex-1 overflow-hidden rounded-full bg-zinc-100">
          <div className="h-2 rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500" style={{ width: `${(s.done / 5) * 100}%` }} />
        </div>
      </div>
      {!(compact && live) && (
        <ol className="space-y-3">
          <Step n={1} done title="Business added">Brand Kit ready. Check the key facts: the AI only says what is there.</Step>
          <Step n={2} done={Boolean(s.channel)} title={s.channel ? `Channel connected: ${s.channel}` : "Connect a channel"}>
            {s.channel ? "Posts go here at their time." : <>Telegram is the quickest (2 minutes, free). <Link href={`/brands/${brand.id}#channels`} className="text-indigo-700 underline">Connect a channel</Link></>}
          </Step>
          <Step n={3} done={s.goal} title={s.goal ? "Goal set: the Director plans every week" : "Set a goal"}>
            {s.goal ? "A new week of posts is made every week by itself." : <><Link href={`/brands/${brand.id}#director`} className="text-indigo-700 underline">Tell the Director what you want</Link> (sales, leads, followers…) and it plans and makes the posts.</>}
          </Step>
          <Step n={4} done={Boolean(s.approval)} title={s.approval === "auto" ? "Auto-approve is on" : s.approval === "manual" ? "Posts approved" : "Approve posts"}>
            <div className="flex flex-wrap items-center gap-2">
              {s.waiting > 0 && <Link href="/review" className="text-indigo-700 underline">{s.waiting} post{s.waiting === 1 ? "" : "s"} waiting for review</Link>}
              {canEdit && (
                <form action={setAutoApproveAction.bind(null, brand.id, !brand.autoApprove)}>
                  <button className={brand.autoApprove ? "btn-secondary" : "btn"} data-testid="auto-approve-toggle">
                    {brand.autoApprove ? "Turn auto-approve off" : "Turn on auto-approve"}
                  </button>
                </form>
              )}
              <span className="text-xs text-zinc-500">Auto-approve: posts that pass the quality check go out by themselves; the rest wait for you.</span>
            </div>
          </Step>
          <Step n={5} done={s.published > 0} title={s.published > 0 ? `${s.published} post${s.published === 1 ? "" : "s"} published` : "First post goes out"}>
            {s.published > 0
              ? "Results come back every day (Analyst) and the Director adjusts the plan."
              : s.nextPostAt
                ? `Next approved post goes out ${formatSlot(s.nextPostAt, brand.timezone)}.`
                : "As soon as a post is approved and its time comes. Keep the app running."}
          </Step>
        </ol>
      )}
    </section>
  );
}
