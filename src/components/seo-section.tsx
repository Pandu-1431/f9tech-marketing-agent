import type { Brand } from "@/db/schema";
import { buildSeoKitAction } from "@/app/actions/seo";
import { AutoRefresh } from "./auto-refresh";
import { friendlyError } from "@/lib/data";

/*
 * SEO & hashtags: keywords people really search (Google + YouTube autocomplete), questions
 * worth a post, and four hashtag sets. Every caption the copywriter writes uses this kit.
 */
const INTENT_CLS: Record<string, string> = {
  learn: "bg-indigo-50 text-indigo-700",
  compare: "bg-amber-50 text-amber-700",
  buy: "bg-emerald-50 text-emerald-700",
  local: "bg-teal-50 text-teal-700",
};

export function SeoSection({ brand, job }: { brand: Brand; job: { running: boolean; error: string | null } }) {
  const kit = brand.seoKit;
  const sets = kit?.hashtagSets;
  return (
    <section id="seo" className="card space-y-4" data-testid="seo-kit">
      <AutoRefresh active={job.running} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">SEO & hashtags</h2>
          <p className="text-sm text-zinc-600">
            Keywords people really type on Google and YouTube for what {brand.name} offers, plus ready hashtag sets. Every new caption uses them.
          </p>
        </div>
        <form action={buildSeoKitAction.bind(null, brand.id)}>
          <button className="btn-secondary" type="submit" disabled={job.running}>
            {job.running ? "Building…" : kit ? "Rebuild SEO kit" : "Build SEO kit"}
          </button>
        </form>
      </div>
      {job.error && <p role="alert" className="text-sm text-red-700">Could not build the kit: {friendlyError(job.error)}</p>}
      {!kit ? (
        <p className="text-sm text-zinc-500">No kit yet. Fill in services and city in the Brand Kit below, then build it (1 AI call).</p>
      ) : (
        <div className="space-y-4 text-sm">
          <div>
            <p className="mb-1 font-medium">Keywords ({kit.keywords.length})</p>
            <ul className="flex flex-wrap gap-1.5">
              {kit.keywords.map((k) => (
                <li key={k.phrase} className={`badge ${INTENT_CLS[k.intent] ?? ""}`} title={`${k.intent} · ${k.cluster}`}>
                  {k.phrase}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-zinc-500">Colour = search intent: learn, compare, buy, local.</p>
          </div>
          {sets && (
            <div className="grid gap-2 sm:grid-cols-2">
              {(["brand", "niche", "local", "broad"] as const).map((k) => (
                <div key={k} className="rounded-lg border border-zinc-100 p-2">
                  <p className="text-xs font-medium uppercase text-zinc-500">{k}</p>
                  <p className="break-words">{sets[k].join(" ") || "—"}</p>
                </div>
              ))}
            </div>
          )}
          {kit.questions.length > 0 && (
            <div>
              <p className="mb-1 font-medium">Questions people ask (good post ideas)</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {kit.questions.map((q) => <li key={q}>{q}</li>)}
              </ul>
            </div>
          )}
          <p className="text-xs text-zinc-500">
            Built {new Date(kit.generatedAt).toLocaleDateString()} from {kit.suggestions.length} real searches.
          </p>
        </div>
      )}
    </section>
  );
}
