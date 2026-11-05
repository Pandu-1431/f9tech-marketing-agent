import { ago, type ActivityItem, type AgentStatus } from "@/lib/team-status";
import { AGENTS } from "@/lib/team-status";

/** Six agent cards: live dot, what each one does, today's count. */
export function AiTeam({ agents }: { agents: AgentStatus[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="ai-team">
      {agents.map((a, i) => (
        <div key={a.key} className={`card card-hover reveal d${(i % 6) + 1} relative overflow-hidden`}>
          <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-20 blur-2xl" style={{ background: a.color }} />
          <div className="flex items-start gap-3">
            <div
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl text-white ${a.working ? "float" : ""}`}
              style={{ background: `linear-gradient(135deg, ${a.color}, ${a.color}aa)`, boxShadow: `0 8px 20px -8px ${a.color}` }}
            >
              {a.emoji}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold">{a.name}</p>
                <span className={`live-dot ${a.working ? "" : a.waiting ? "warn" : "idle"}`} />
                <span className="text-xs font-medium" style={{ color: a.working ? "#059669" : a.waiting ? "#b45309" : "#71717a" }}>
                  {a.working ? (
                    <>
                      working <span className="typing"><span /><span /><span /></span>
                    </>
                  ) : a.waiting ? (
                    `${a.waiting} in line`
                  ) : (
                    "ready"
                  )}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-zinc-500">{a.role}</p>
            </div>
          </div>
          <div className="mt-4 flex items-end justify-between">
            <div>
              <p className="text-2xl font-bold" style={{ color: a.color }}>{a.doneToday}</p>
              <p className="text-[11px] uppercase tracking-wide text-zinc-400">done in 24 h</p>
            </div>
            <p className="text-xs text-zinc-500">last: {ago(a.lastAt)}</p>
          </div>
          {a.working && <div className="shimmer absolute inset-x-0 bottom-0 h-1" style={{ backgroundColor: a.color }} />}
        </div>
      ))}
    </div>
  );
}

/** The live feed of what the AI team just did. */
export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  const color = (k: string) => AGENTS.find((a) => a.key === k)?.color ?? "#7c3aed";
  const emoji = (k: string) => AGENTS.find((a) => a.key === k)?.emoji ?? "✨";
  if (!items.length) return <p className="text-sm text-white/60">No AI work yet. Start a campaign and watch the team go.</p>;
  return (
    <ul className="space-y-2.5" data-testid="activity-feed">
      {items.map((it, i) => (
        <li key={it.id} className={`reveal d${Math.min(6, i + 1)} flex items-center gap-3 text-sm`}>
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-sm" style={{ background: `${color(it.agent)}33` }}>
            {emoji(it.agent)}
          </span>
          <span className={`min-w-0 flex-1 truncate ${it.ok ? "text-white/90" : "text-amber-200/90"}`}>
            {AGENTS.find((a) => a.key === it.agent)?.name} {it.text}
          </span>
          <span className="shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/60">{it.provider}</span>
          <span className="w-16 shrink-0 text-right text-xs text-white/45">{ago(it.at)}</span>
        </li>
      ))}
    </ul>
  );
}
