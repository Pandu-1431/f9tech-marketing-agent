import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEditor } from "@/lib/auth";
import { getBrand } from "@/lib/data";
import { listArticles, suggestTopics } from "@/agent/articles";
import { writeArticleAction } from "@/app/actions/articles";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

/** Blog & SEO writer for one business: suggested topics from the SEO kit, and the articles written so far. */
export default async function ArticlesPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspace } = await requireEditor();
  const brand = await getBrand(workspace.id, Number((await params).id));
  if (!brand) notFound();
  const articles = await listArticles(workspace.id, brand.id);
  const topics = suggestTopics(brand, articles.map((a) => a.topic));
  const writing = articles.some((a) => a.status === "writing");

  return (
    <div className="max-w-3xl space-y-6" data-testid="articles">
      <AutoRefresh active={writing} />
      <div>
        <Link href={`/brands/${brand.id}`} className="text-sm text-zinc-500">← {brand.name}</Link>
        <h1 className="text-2xl font-semibold">Blog &amp; SEO articles</h1>
        <p className="text-sm text-zinc-600">
          Articles for {brand.name}&apos;s website about what people really search on Google. Copy them into WordPress, Blogger or any site:
          they bring visitors from search for months.
        </p>
      </div>

      <form action={writeArticleAction.bind(null, brand.id)} className="card space-y-3">
        <label className="label" htmlFor="topic">Topic or question</label>
        <div className="flex flex-wrap gap-2">
          <input className="input min-w-[260px] flex-1" id="topic" name="topic" required minLength={4} maxLength={200} placeholder="e.g. How to choose the right coaching for class 10" />
          <button className="btn">Write article</button>
        </div>
        {topics.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs text-zinc-500">Suggested from your SEO kit:</span>
            {topics.map((t) => (
              <button key={t} name="topic" value={t} formNoValidate className="badge border border-indigo-200 bg-indigo-50 text-indigo-700">{t}</button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-500">Build the SEO kit on the business page to get topic ideas people really search.</p>
        )}
      </form>

      <div className="space-y-2">
        {articles.map((a) => (
          <Link key={a.id} href={`/brands/${brand.id}/articles/${a.id}`} className="card flex items-center gap-3 hover:bg-zinc-50">
            <div className="flex-1">
              <p className="font-medium">{a.title ?? a.topic}</p>
              <p className="text-xs text-zinc-500">{a.status === "ready" ? `${a.words} words · ${a.createdAt.toISOString().slice(0, 10)}` : a.status === "writing" ? "Writing…" : `Failed: ${a.error ?? ""}`}</p>
            </div>
            <span className={`badge ${a.status === "ready" ? "bg-emerald-50 text-emerald-700" : a.status === "writing" ? "bg-indigo-50 text-indigo-700" : "bg-red-50 text-red-700"}`}>{a.status}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
