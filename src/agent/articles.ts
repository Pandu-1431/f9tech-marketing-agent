import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Article, Brand } from "@/db/schema";
import { newKey, putFile } from "@/lib/storage";
import { isDemoProvider } from "@/lib/data";
import { wordCount } from "@/lib/markdown";
import { brandSystemPromptWithMemory } from "./brand-context";
import { generateImage } from "./images/router";
import { imagePrompt } from "./style";
import { parseJsonObject } from "./json";
import { generateText } from "./router";

/*
 * Blog & SEO writer: one website article per topic, built on the brand's SEO kit (what people
 * really search). Facts only from the Brand Kit; ends with a call to action to the website or the
 * enquiry page; a free AI cover image. The owner copies it into WordPress / Blogger / any site.
 */

/** Topics worth an article: the SEO kit's questions and "learn" keywords not written yet. */
export function suggestTopics(brand: Pick<Brand, "seoKit" | "services">, written: string[], max = 8): string[] {
  const done = new Set(written.map((t) => t.toLowerCase().trim()));
  const kit = brand.seoKit;
  const fromKit = [
    ...(kit?.questions ?? []),
    ...(kit?.keywords ?? []).filter((k) => k.intent === "learn" || k.intent === "compare").map((k) => k.phrase),
  ];
  const fromServices = (brand.services ?? "").split("\n").map((s) => s.trim()).filter(Boolean).map((s) => `${s}: a complete guide`);
  return [...new Set([...fromKit, ...fromServices])].filter((t) => !done.has(t.toLowerCase().trim())).slice(0, max);
}

export function articlePrompt(brand: Brand, topic: string, ctaUrl: string | null): string {
  const keywords = brand.seoKit?.keywords.slice(0, 10).map((k) => k.phrase) ?? brand.keywords;
  return [
    "TASK: BLOG_ARTICLE",
    `TOPIC: ${topic}`,
    keywords.length ? `RELATED SEARCHES: ${keywords.join(" | ")}` : "",
    ctaUrl ? `CALL TO ACTION LINK: ${ctaUrl}` : "",
    "",
    "Write a helpful website article (blog post) for this business, for people who search the TOPIC.",
    "- 800 to 1100 words in Markdown. Start with a 2-3 sentence intro that answers the question directly (no heading before it).",
    "- Then 4-6 sections with ## headings (use ### for sub-points), short paragraphs, bullet lists where they help.",
    "- Use the topic phrase naturally in the intro and one heading; use 2-3 related searches where they fit. No keyword stuffing.",
    "- Be genuinely useful: steps, examples, mistakes to avoid. Mention the business where it truly helps, not in every section.",
    "- Only state facts about the business that are in its key facts. No made-up numbers, prices, awards or reviews.",
    `- End with a short ## section that invites the reader to act${ctaUrl ? ` with a Markdown link to ${ctaUrl}` : ""}.`,
    "- faq: 3-4 questions people also ask, with 1-3 sentence answers (these are NOT repeated in the body).",
    "- title: max 60 characters, includes the topic. meta_description: 140-155 characters. slug: lowercase-words-with-hyphens.",
    'Reply with JSON only: {"title":"","slug":"","meta_description":"","keyword":"","body":"markdown","faq":[{"q":"","a":""}]}',
  ]
    .filter(Boolean)
    .join("\n");
}

const articleSchema = z.object({
  title: z.string().min(3),
  slug: z.string().default(""),
  meta_description: z.string().default(""),
  keyword: z.string().default(""),
  body: z.string().min(200),
  faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
});

const MIN_WORDS = 600;

export const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

export async function startArticle(workspaceId: number, brandId: number, topic: string): Promise<Article> {
  const db = await getDb();
  const [row] = await db.insert(schema.articles).values({ workspaceId, brandId, topic: topic.trim().slice(0, 200) }).returning();
  return row;
}

/** Write the article (and its cover). Run by the "article.write" job. */
export async function writeArticle(workspaceId: number, articleId: number): Promise<Article> {
  const db = await getDb();
  const [a] = await db.select().from(schema.articles).where(and(eq(schema.articles.workspaceId, workspaceId), eq(schema.articles.id, articleId)));
  if (!a) throw new Error("Article not found");
  const [brand] = await db.select().from(schema.brands).where(eq(schema.brands.id, a.brandId));
  if (!brand) throw new Error("Business not found");
  const ctaUrl = brand.website ?? null;
  try {
    const out = await generateText(
      { workspaceId, brandId: brand.id, purpose: "blog_article", subject: { type: "article", id: a.id } },
      { system: await brandSystemPromptWithMemory(brand), prompt: articlePrompt(brand, a.topic, ctaUrl), json: true, temperature: 0.6 },
    );
    let p = articleSchema.parse(parseJsonObject(out.text));
    // Free models often stop short: ask once more for a fuller article, keep the longer one.
    if (wordCount(p.body) < MIN_WORDS) {
      try {
        const again = await generateText(
          { workspaceId, brandId: brand.id, purpose: "blog_article", subject: { type: "article", id: a.id } },
          {
            system: await brandSystemPromptWithMemory(brand),
            prompt: `${articlePrompt(brand, a.topic, ctaUrl)}\n\nIMPORTANT: your last draft had only ${wordCount(p.body)} words. Write at least 900 words: more sections, concrete steps and examples.`,
            json: true,
            temperature: 0.6,
          },
        );
        const longer = articleSchema.parse(parseJsonObject(again.text));
        if (wordCount(longer.body) > wordCount(p.body)) p = longer;
      } catch {
        // keep the first draft
      }
    }
    const body = p.body.replace(/^#\s+.*\n+/, ""); // the title is shown separately
    let coverKey: string | null = null;
    try {
      const img = await generateImage(
        { workspaceId, brandId: brand.id, purpose: "article_cover", subject: { type: "article", id: a.id } },
        { prompt: `${imagePrompt(brand, p.title, "band")}. Wide blog header photo, no text`, width: 1200, height: 630, colors: brand.colors, seed: a.id },
      );
      if (!isDemoProvider(img.provider) && img.provider !== "brand_art") {
        coverKey = newKey(workspaceId, "cover", img.mime);
        await putFile(coverKey, img.data, img.mime);
      }
    } catch {
      // an article without a cover is still useful
    }
    const [row] = await db
      .update(schema.articles)
      .set({
        title: p.title.slice(0, 200),
        slug: slugify(p.slug || p.title),
        metaDescription: p.meta_description.slice(0, 200),
        keyword: p.keyword.slice(0, 120) || null,
        body,
        faq: p.faq.slice(0, 6).map((f) => ({ q: f.q.slice(0, 200), a: f.a.slice(0, 600) })),
        coverKey,
        words: wordCount(body),
        status: "ready",
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.articles.id, a.id))
      .returning();
    return row;
  } catch (err) {
    await db.update(schema.articles).set({ status: "failed", error: (err instanceof Error ? err.message : String(err)).slice(0, 500), updatedAt: new Date() }).where(eq(schema.articles.id, a.id));
    throw err;
  }
}

export async function listArticles(workspaceId: number, brandId: number) {
  const db = await getDb();
  return db.select().from(schema.articles).where(and(eq(schema.articles.workspaceId, workspaceId), eq(schema.articles.brandId, brandId))).orderBy(desc(schema.articles.id));
}

export async function getArticle(workspaceId: number, id: number) {
  const db = await getDb();
  const [a] = await db.select().from(schema.articles).where(and(eq(schema.articles.workspaceId, workspaceId), eq(schema.articles.id, id)));
  return a ?? null;
}

/** Full HTML for pasting into a website: title, body, FAQ (with FAQPage structured data for Google). */
export function articleHtml(a: Article, bodyHtml: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const faqHtml = a.faq.length ? `\n<h2>Frequently asked questions</h2>\n${a.faq.map((f) => `<h3>${esc(f.q)}</h3>\n<p>${esc(f.a)}</p>`).join("\n")}` : "";
  const ld = a.faq.length
    ? `\n<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: a.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }).replace(/</g, "\\u003c")}</script>`
    : "";
  return `<h1>${esc(a.title ?? a.topic)}</h1>\n${bodyHtml}${faqHtml}${ld}`;
}
