/** Plan → Write → Design → Check → Approve → Publish, with a dot flowing along the live step. */
export type StepState = "done" | "active" | "todo";

export function Pipeline({ steps }: { steps: { label: string; icon: string; state: StepState; note?: string }[] }) {
  return (
    <div className="flex items-start" data-testid="pipeline">
      {steps.map((s, i) => (
        <div key={s.label} className="flex flex-1 items-start last:flex-none">
          <div className="flex w-16 flex-col items-center text-center sm:w-20">
            <div
              className={`relative grid h-11 w-11 place-items-center rounded-2xl text-lg transition-all ${
                s.state === "done"
                  ? "bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/30"
                  : s.state === "active"
                    ? "bg-white text-indigo-700 ring-2 ring-fuchsia-400"
                    : "bg-white/60 text-zinc-400 ring-1 ring-zinc-200"
              }`}
            >
              {s.state === "done" ? "✓" : s.icon}
              {s.state === "active" && <span className="absolute -right-0.5 -top-0.5 live-dot" />}
            </div>
            <p className={`mt-1.5 text-xs font-semibold ${s.state === "todo" ? "text-zinc-400" : "text-zinc-800"}`}>{s.label}</p>
            {s.note && <p className="text-[10px] leading-tight text-zinc-500">{s.note}</p>}
          </div>
          {i < steps.length - 1 && <div className={`flow-line mt-5 flex-1 ${s.state === "active" ? "" : "still"} ${s.state === "done" ? "opacity-100" : "opacity-50"}`} />}
        </div>
      ))}
    </div>
  );
}
