import type { Brand, BrandMemory } from "@/db/schema";
import { addMemoryAction, forgetMemoryAction, runAnalystNowAction } from "@/app/actions/memory";
import { ago } from "@/lib/team-status";

/*
 * What the AI team has learned about this brand. The Analyst fills it from post results,
 * reviewers add rules by rejecting posts with a note, and a person can add a line here.
 * Every strategist, planner, copywriter and reel-script prompt reads these lines.
 */
const KIND_LABEL: Record<string, { text: string; cls: string }> = {
  learning: { text: "From results", cls: "bg-teal-50 text-teal-700" },
  feedback: { text: "Reviewer rule", cls: "bg-amber-50 text-amber-700" },
  fact: { text: "Team note", cls: "bg-indigo-50 text-indigo-700" },
};

export function MemorySection({ brand, memory, measured }: { brand: Brand; memory: BrandMemory[]; measured: number }) {
  return (
    <section id="memory" className="card space-y-4" data-testid="brand-memory">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Brand memory</h2>
          <p className="text-sm text-zinc-600">
            What the team learned about {brand.name}. The Analyst reads post results once a day ({measured} post{measured === 1 ? "" : "s"} measured so far),
            rejection notes become rules, and every new post follows these lines.
          </p>
        </div>
        <form action={runAnalystNowAction.bind(null, brand.id)}>
          <button className="btn-secondary" type="submit">Read results now</button>
        </form>
      </div>
      <p className="text-xs text-zinc-500">
        Last read: {brand.analystLastRunAt ? ago(brand.analystLastRunAt) : "not yet"}. Results need a connected Facebook, Instagram or YouTube channel; Telegram gives no numbers.
      </p>
      {memory.length === 0 ? (
        <p className="text-sm text-zinc-500">Nothing learned yet. Publish a few posts, or add a note below.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 text-sm">
          {memory.map((m) => {
            const k = m.source === "editor" ? { text: "From an edit", cls: "bg-amber-50 text-amber-700" } : (KIND_LABEL[m.kind] ?? KIND_LABEL.fact);
            return (
              <li key={m.id} className="flex flex-wrap items-start gap-2 py-2">
                <span className={`badge ${k.cls}`}>{k.text}</span>
                <span className="min-w-0 flex-1">{m.text}</span>
                {m.weight > 1 && <span className="text-xs text-zinc-400">{m.weight} posts</span>}
                <form action={forgetMemoryAction.bind(null, brand.id, m.id)}>
                  <button className="text-xs text-red-600 underline" type="submit">Forget</button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
      <form action={addMemoryAction.bind(null, brand.id)} className="flex flex-wrap gap-2">
        <input className="input min-w-0 flex-1" name="text" maxLength={300} placeholder="Add a note the team should always follow, e.g. “Students revise at night; evening posts work”" />
        <button className="btn-secondary" type="submit">Add note</button>
      </form>
    </section>
  );
}
