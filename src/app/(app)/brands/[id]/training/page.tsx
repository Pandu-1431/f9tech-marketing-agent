import Link from "next/link";
import { Crumbs } from "@/components/ui/crumbs";
import { notFound } from "next/navigation";
import { requireEditor } from "@/lib/auth";
import { getBrand } from "@/lib/data";
import { listMemory } from "@/agent/memory";
import { listExemplars, pickExemplars } from "@/agent/training/exemplars";
import { buildDataset, READINESS } from "@/agent/training/dataset";

/*
 * Training center: how this brand's AI team learns, and what it has learned so far.
 * Three layers, cheapest first: examples in prompts (now), rules in memory (now),
 * fine-tuning a model on the exported data (later, once there is enough of it).
 */

const WHY = { measured: "Strong results", edited: "Edited & approved", approved: "Approved" } as const;
const WHY_CLS = { measured: "bg-teal-50 text-teal-700", edited: "bg-amber-50 text-amber-700", approved: "bg-indigo-50 text-indigo-700" } as const;

export default async function TrainingPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspace } = await requireEditor();
  const { id } = await params;
  const brand = await getBrand(workspace.id, Number(id));
  if (!brand) notFound();

  const [exemplars, memory, dataset] = await Promise.all([
    listExemplars(workspace.id, brand.id),
    listMemory(workspace.id, brand.id),
    buildDataset(workspace.id, brand),
  ]);
  const inUse = pickExemplars(exemplars, brand.platforms.length ? brand.platforms : exemplars.map((e) => e.platform), 3);
  const rules = memory.filter((m) => m.kind === "feedback");
  const learnings = memory.filter((m) => m.kind === "learning");
  const { stats } = dataset;
  const pct = Math.min(100, Math.round((stats.sft / READINESS.goodAt) * 100));
  const stage = stats.sft >= READINESS.goodAt ? "Ready to fine-tune" : stats.sft >= READINESS.tryAt ? "Enough for a first try" : "Collecting";

  return (
    <div className="max-w-3xl space-y-6" data-testid="training-center">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Crumbs items={[{ href: "/brands", label: "Business accounts" }, { href: `/brands/${brand.id}`, label: brand.name }, { label: "Training center" }]} />
          <h1 className="text-2xl font-semibold">Training center</h1>
          <p className="text-sm text-zinc-600">
            How the AI team learns {brand.name}&apos;s voice. Every approval, edit, rejection and post result teaches it. No setup needed.
          </p>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Approved posts" value={stats.approved} />
        <Stat label="Edited by a person" value={stats.edited} />
        <Stat label="Rejected, then fixed" value={stats.rejectedThenApproved} />
        <Stat label="Rules learned" value={rules.length + learnings.length} />
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">1. Examples the writer follows</h2>
        <p className="text-sm text-zinc-600">
          Before writing, the copywriter reads up to 3 of the brand&apos;s best posts (same platform first): measured winners, then posts a person edited and approved, then approved posts.
        </p>
        {inUse.length === 0 ? (
          <p className="text-sm text-zinc-500">No examples yet. Approve a few posts and they show up here.</p>
        ) : (
          <ul className="space-y-3">
            {inUse.map((e) => (
              <li key={e.postId} className="rounded-lg border border-zinc-100 p-3 text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span className={`badge ${WHY_CLS[e.why]}`}>{WHY[e.why]}</span>
                  <span>{e.platform} · {e.format}</span>
                  {e.score !== null && <span>score {Math.round(e.score)}</span>}
                </div>
                {e.posterHeadline && <p className="font-medium">{e.posterHeadline}</p>}
                <p className="line-clamp-3 whitespace-pre-line text-zinc-700">{e.caption}</p>
              </li>
            ))}
          </ul>
        )}
        {exemplars.length > inUse.length && <p className="text-xs text-zinc-500">{exemplars.length} usable examples in total.</p>}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">2. Rules in brand memory</h2>
        <p className="text-sm text-zinc-600">
          Rejection notes become rules. When a person rewrites a caption and approves it, the AI works out the rule behind the change. The Analyst adds what post results show.
        </p>
        {rules.length + learnings.length === 0 ? (
          <p className="text-sm text-zinc-500">No rules yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {[...rules, ...learnings].slice(0, 12).map((m) => (
              <li key={m.id} className="flex items-start gap-2 py-2">
                <span className="badge bg-zinc-100 text-zinc-600">{m.source === "editor" ? "From an edit" : m.source === "reviewer" ? "Reviewer" : "Results"}</span>
                <span className="min-w-0 flex-1">{m.text}</span>
              </li>
            ))}
          </ul>
        )}
        <Link href={`/brands/${brand.id}#memory`} className="text-sm underline">Manage memory</Link>
      </section>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">3. Fine-tuning data (optional)</h2>
          <span className="badge bg-zinc-100 text-zinc-700">{stage}</span>
        </div>
        <p className="text-sm text-zinc-600">
          A custom model trained only on {brand.name}&apos;s approved posts. Worth it from about {READINESS.tryAt} approved posts, good at {READINESS.goodAt}+.
          Files use the OpenAI chat format (also read by Together, Fireworks and Unsloth).
        </p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100" aria-label={`${stats.sft} of ${READINESS.goodAt} examples`}>
          <div className="h-full rounded-full bg-teal-500" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-zinc-500">{stats.sft} of {READINESS.goodAt} examples · {stats.dpo} preference pairs</p>
        <div className="flex flex-wrap gap-2">
          <a className="btn-secondary" href={`/api/training/${brand.id}?type=sft`} download>
            Download examples (SFT, {stats.sft})
          </a>
          <a className="btn-secondary" href={`/api/training/${brand.id}?type=dpo`} download>
            Download preferences (DPO, {stats.dpo})
          </a>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-zinc-500">{label}</p>
    </div>
  );
}
