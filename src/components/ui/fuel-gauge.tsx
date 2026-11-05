import type { ConnectionRow } from "@/lib/connections";
import { untilText } from "@/lib/team-status";
import { Ring } from "./ring";

const TASK_TITLE = { text: "Writing AIs", image: "Image AIs", voice: "Voice AIs" } as const;
const UNLIMITED = 100_000;

/**
 * Free-AI fuel gauge: every free provider in the chain, how much of today's free limit is used,
 * and which one is resting. The team uses each in order until its limit, then moves to the next.
 */
export function FuelGauge({ rows }: { rows: ConnectionRow[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-3" data-testid="fuel-gauge">
      {(["text", "image", "voice"] as const).map((task) => {
        const list = rows.filter((r) => r.task === task && r.name !== "fake" && r.name !== "silent");
        const activeName = list.find((r) => r.configured && !r.restUntil && r.usedToday < r.dailyLimit)?.name;
        return (
          <div key={task} className="card">
            <p className="mb-3 text-sm font-semibold">{TASK_TITLE[task]}</p>
            {list.length === 0 && <p className="text-xs text-zinc-500">Only the built-in fallback is set up. Add a free key in AI connections.</p>}
            <ul className="space-y-3">
              {list.map((r) => {
                const unlimited = r.dailyLimit >= UNLIMITED;
                const left = unlimited ? 1 : Math.max(0, 1 - r.usedToday / Math.max(1, r.dailyLimit));
                const resting = Boolean(r.restUntil);
                const color = !r.configured ? "#a1a1aa" : resting ? "#f59e0b" : left < 0.15 ? "#ef4444" : "#10b981";
                return (
                  <li key={r.name} className="flex items-center gap-3">
                    <Ring value={r.configured ? (resting ? 0.02 : left) : 0} size={44} stroke={5} color={color} label={unlimited ? "∞" : `${Math.round(left * 100)}`} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        {r.label}
                        {r.name === activeName && <span className="badge whitespace-nowrap bg-emerald-50 text-emerald-700"><span className="live-dot" /> in use</span>}
                      </p>
                      <p className="truncate text-xs text-zinc-500">
                        {!r.configured
                          ? "not connected (add key in AI connections)"
                          : resting
                            ? `resting — back in ${untilText(r.restUntil!)}`
                            : unlimited
                              ? "always available"
                              : `${r.usedToday} of ${r.dailyLimit} used today`}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
