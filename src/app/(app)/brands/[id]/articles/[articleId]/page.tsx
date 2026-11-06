import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEditor } from "@/lib/auth";
import { getBrand } from "@/lib/data";
import { articleHtml, getArticle } from "@/agent/articles";
import { deleteArticleAction, writeArticleAction } from "@/app/actions/articles";
import { markdownToHtml } from "@/lib/markdown";
import { publicUrl } from "@/lib/storage";
import { AutoRefresh } from "@/components/auto-refresh";
import { CopyButton } from "@/components/copy-button";

export const dynamic = "force-dynamic";

export default async function ArticlePage({ params }: { params: Promise<{ id: string; articleId: string }> }) {
  const { workspace } = await requireEditor();
  const p = await params;
  const brand = await getBrand(workspace.id, Number(p.id));
  const a = await getArticle(workspace.id, Number(p.articleId));
  if (!brand || !a || a.brandId !== brand.id) notFound();
  const html = a.body ? markdownToHtml(a.body) : "";

  return (
    <div className="max-w-3xl space-y-5" data-testid="article">
      <AutoRefresh active={a.status === "writing"} />
      <Link href={`/brands/${brand.id}/articles`} className="text-sm text-zinc-500">← All articles</Link>
      {a.status === "writing" && <div className="card text-sm text-indigo-700">Writing “{a.topic}”… this takes about a minute.</div>}
      {a.status === "failed" && (
        <div className="card space-y-2 text-sm text-red-700">
          <p>Could not write this article: {a.error}</p>
          <form action={writeArticleAction.bind(null, brand.id)}>
            <input type="hidden" name="topic" value={a.topic} />
            <button className="btn-secondary">Try again</button>
          </form>
        </div>
      )}
      {a.status === "ready" && (
        <>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={articleHtml(a, html)} label="Copy HTML" />
            <CopyButton text={`# ${a.title}\n\n${a.body}`} label="Copy Markdown" />
            <a className="btn-secondary" href={`/api/articles/${a.id}?format=html`}>Download .html</a>
            <a className="btn-secondary" href={`/api/articles/${a.id}?format=md`}>Download .md</a>
            <form action={deleteArticleAction.bind(null, brand.id, a.id)} className="ml-auto">
              <button className="btn-secondary text-red-600">Delete</button>
            </form>
          </div>
          <div className="card space-y-1 text-sm">
            <p><b>SEO title:</b> {a.title} <span className="text-zinc-400">({a.title?.length ?? 0} chars)</span></p>
            <p><b>Meta description:</b> {a.metaDescription} <span className="text-zinc-400">({a.metaDescription?.length ?? 0} chars)</span></p>
            <p><b>URL slug:</b> /{a.slug} · <b>Words:</b> {a.words}</p>
          </div>
          <article className="card prose-article space-y-3">
            {a.coverKey && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={publicUrl(a.coverKey)} alt="" className="w-full rounded-lg" />
            )}
            <h1 className="text-2xl font-semibold">{a.title}</h1>
            <div className="article-body" dangerouslySetInnerHTML={{ __html: html }} />
            {a.faq.length > 0 && (
              <section>
                <h2>Frequently asked questions</h2>
                {a.faq.map((f) => (
                  <div key={f.q}>
                    <h3>{f.q}</h3>
                    <p>{f.a}</p>
                  </div>
                ))}
              </section>
            )}
          </article>
        </>
      )}
    </div>
  );
}
