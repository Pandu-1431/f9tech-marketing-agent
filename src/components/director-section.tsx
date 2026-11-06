import Link from "next/link";
import type { Brand } from "@/db/schema";
import { clearGoalAction, remakePlanAction, saveGoalAction, startWeekNowAction } from "@/app/actions/director";
import { OBJECTIVES } from "@/agent/director";
import { DAY_NAMES } from "@/agent/autopilot";
import { friendlyError } from "@/lib/data";
import { AutoRefresh } from "./auto-refresh";

/*
 * Marketing Director: set a goal once; the AI writes a four-week plan, runs one week at a time
 * through the autopilot, reviews each week's results and adjusts.
 */
export function DirectorSection({
  brand,
  job,
  campaigns,
}: {
  brand: Brand;
  job: { running: boolean; error: string | null };
  campaigns: Map<string, { id: number; status: string }>;
}) {
  const goal = brand.marketingGoal;
  const plan = brand.marketingPlan;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section id="director" className="card scroll-mt-32 space-y-4" data-testid="director">
      <AutoRefresh active={job.running} />
      <div>
        <h2 className="font-semibold">🧠 Marketing Director</h2>
        <p className="text-sm text-zinc-600">
          Tell it what you want from marketing. It writes a 4-week plan, makes each week&apos;s posts automatically
          ({DAY_NAMES[brand.autopilotDay]} mornings), checks the results every week and changes the plan when something is not working.
          You only approve posts.
        </p>
      </div>

      <form action={saveGoalAction.bind(null, brand.id)} className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="label" htmlFor="objective">Main goal</label>
          <select className="input" id="objective" name="objective" defaultValue={goal?.objective ?? "awareness"}>
            {OBJECTIVES.map((o) => (
              <option key={o.key} value={o.key}>{o.label}: {o.hint}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="target">Target (optional)</label>
          <input className="input" id="target" name="target" defaultValue={goal?.target ?? ""} placeholder="e.g. 500 app installs this month" />
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="focus">Focus or offer (optional)</label>
          <input className="input" id="focus" name="focus" defaultValue={goal?.focus ?? ""} placeholder="e.g. push the new mock test series; students in Telangana" />
        </div>
        <div>
          <label className="label" htmlFor="postsPerWeek">Posts per week</label>
          <input className="input" id="postsPerWeek" name="postsPerWeek" type="number" min={1} max={14} defaultValue={goal?.postsPerWeek ?? brand.autopilotPostsPerWeek} />
        </div>
        <div className="flex items-end gap-2">
          <button className="btn" disabled={job.running}>{goal ? "Save goal and re-plan" : "Start the Director"}</button>
        </div>
      </form>

      {job.running && <p className="text-sm text-indigo-700">The Director is working on the plan…</p>}
      {job.error && !job.running && <p className="text-sm text-red-700">Last try failed: {friendlyError(job.error)}</p>}

      {plan && (
        <div className="space-y-4 border-t border-zinc-100 pt-4" data-testid="director-plan">
          <p className="text-sm text-zinc-800">{plan.summary}</p>

          {plan.pillars.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Content mix</p>
              <div className="flex h-3 overflow-hidden rounded-full">
                {plan.pillars.map((p, i) => (
                  <div key={p.name} style={{ width: `${p.share}%`, background: ["#6366f1", "#f59e0b", "#10b981", "#ec4899", "#0ea5e9"][i % 5] }} title={`${p.name} ${p.share}%`} />
                ))}
              </div>
              <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                {plan.pillars.map((p) => (
                  <li key={p.name}>
                    <b>{p.name}</b> {p.share}% <span className="text-zinc-500">· e.g. {p.example}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr><th className="py-1 pr-3">Week</th><th className="pr-3">Theme</th><th className="pr-3">Formats</th><th>Status</th></tr>
              </thead>
              <tbody>
                {plan.weeks.map((w) => {
                  const c = campaigns.get(w.start);
                  return (
                    <tr key={w.start} className="border-t border-zinc-100 align-top">
                      <td className="whitespace-nowrap py-2 pr-3 text-zinc-600">{w.start.slice(5)} → {w.end.slice(5)}</td>
                      <td className="pr-3">
                        <b>{w.theme}</b>
                        {w.callToAction && <span className="text-zinc-500"> · {w.callToAction}</span>}
                        {w.why && <p className="text-xs text-zinc-500">{w.why}</p>}
                      </td>
                      <td className="pr-3 text-xs text-zinc-600">{w.formats.join(", ") || "mixed"}</td>
                      <td className="whitespace-nowrap text-xs">
                        {c ? (
                          <Link href={`/campaigns/${c.id}`} className="text-indigo-700 underline">Made · {c.status}</Link>
                        ) : w.end < today ? (
                          <span className="text-zinc-400">Missed</span>
                        ) : (
                          <span className="text-zinc-500">Planned</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {plan.kpis.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {plan.kpis.map((k) => (
                <span key={k.metric} className="badge bg-emerald-50 text-emerald-800">🎯 {k.metric}: {k.target}</span>
              ))}
            </div>
          )}

          {plan.reviews.length > 0 && (
            <div className="rounded-lg bg-zinc-50 p-3 text-sm">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Last weekly review ({plan.reviews.at(-1)!.week})</p>
              <p>{plan.reviews.at(-1)!.text}</p>
              {plan.reviews.at(-1)!.changes.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-zinc-700">
                  {plan.reviews.at(-1)!.changes.map((c) => <li key={c}>{c}</li>)}
                </ul>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <form action={startWeekNowAction.bind(null, brand.id)}>
              <button className="btn-secondary" disabled={job.running}>Make this week&apos;s posts now</button>
            </form>
            <form action={remakePlanAction.bind(null, brand.id)}>
              <button className="btn-secondary" disabled={job.running}>Write a new plan</button>
            </form>
            <form action={clearGoalAction.bind(null, brand.id)}>
              <button className="btn-secondary text-zinc-500">Stop the Director</button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
