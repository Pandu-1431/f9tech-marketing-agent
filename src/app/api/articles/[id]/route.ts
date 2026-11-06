import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { articleHtml, getArticle } from "@/agent/articles";
import { markdownToHtml } from "@/lib/markdown";

export const dynamic = "force-dynamic";

/** Download an article as .md or .html (for WordPress, Blogger or any site). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return new NextResponse("Log in first", { status: 401 });
  const a = await getArticle(auth.workspace.id, Number((await ctx.params).id));
  if (!a || a.status !== "ready" || !a.body) return new NextResponse("Not found", { status: 404 });
  const format = new URL(req.url).searchParams.get("format") === "md" ? "md" : "html";
  const name = `${a.slug || "article"}.${format}`;
  const body =
    format === "md"
      ? `# ${a.title}\n\n${a.body}\n${a.faq.length ? `\n## Frequently asked questions\n\n${a.faq.map((f) => `### ${f.q}\n\n${f.a}`).join("\n\n")}\n` : ""}`
      : articleHtml(a, markdownToHtml(a.body));
  return new NextResponse(body, {
    headers: { "content-type": format === "md" ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8", "content-disposition": `attachment; filename="${name}"` },
  });
}
