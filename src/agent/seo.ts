import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Brand, SeoKit } from "@/db/schema";
import { brandServices, brandSystemPrompt } from "./brand-context";
import { parseJsonObject } from "./json";
import { generateText } from "./router";

/*
 * SEO / SMO kit (Layer 4). Keywords the brand's customers really type, not guesses:
 *   1. seeds from the Brand Kit (services, industry, city);
 *   2. Google and YouTube autocomplete for each seed (free, no key) = real searches;
 *   3. one AI call groups them into keyword clusters with search intent, picks the questions
 *      worth a post, and builds four hashtag sets (brand, niche, local, broad).
 * The kit is saved on the brand; every writing prompt then uses its keywords and hashtags.
 * Autocomplete can fail (offline, blocked): the AI then works from the seeds alone.
 */

const SUGGEST = () => (process.env.SUGGEST_URL ?? "https://suggestqueries.google.com/complete/search").replace(/\/$/, "");
const MAX_SEEDS = 8;
const MAX_SUGGESTIONS = 80;

/** Autocomplete for one phrase. `youtube` = what people search on YouTube. Never throws. */
export async function searchSuggestions(seed: string, source: "google" | "youtube" = "google", lang = "en"): Promise<string[]> {
  const u = new URL(SUGGEST());
  u.searchParams.set("client", "firefox");
  u.searchParams.set("hl", lang);
  u.searchParams.set("q", seed);
  if (source === "youtube") u.searchParams.set("ds", "yt");
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const json = (await res.json()) as unknown;
    const list = Array.isArray(json) && Array.isArray(json[1]) ? (json[1] as unknown[]) : [];
    return list.filter((s): s is string => typeof s === "string").map((s) => s.trim().toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Seed phrases from the Brand Kit: services, then industry, each with and without the city. */
export function seoSeeds(brand: Pick<Brand, "services" | "industry" | "city" | "keywords">): string[] {
  const city = brand.city?.trim().toLowerCase();
  const base = [...brandServices(brand), ...(brand.keywords ?? []), brand.industry ?? ""]
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 2);
  const out: string[] = [];
  for (const b of base) {
    out.push(b);
    if (city && !b.includes(city)) out.push(`${b} ${city}`);
  }
  return [...new Set(out)].slice(0, MAX_SEEDS);
}

/** All suggestions for the seeds (Google + YouTube), de-duplicated. */
export async function gatherSuggestions(seeds: string[], lang = "en"): Promise<string[]> {
  const lists = await Promise.all(seeds.flatMap((s) => [searchSuggestions(s, "google", lang), searchSuggestions(s, "youtube", lang)]));
  return [...new Set(lists.flat())].slice(0, MAX_SUGGESTIONS);
}

export function seoKitPrompt(seeds: string[], suggestions: string[]): string {
  return [
    "TASK: SEO_KIT",
    `SEEDS: ${seeds.join("; ") || "use the brand kit"}`,
    "REAL SEARCHES (Google and YouTube autocomplete; these are what people actually type):",
    ...(suggestions.length ? suggestions.map((s) => `- ${s}`) : ["- none available; work from the seeds and the brand kit"]),
    "",
    "Build this brand's SEO and social kit:",
    "- keywords: 12-20 phrases worth targeting, mostly taken from the real searches. For each: phrase, intent (learn | compare | buy | local), cluster (a 1-3 word topic name).",
    "- questions: 5-8 questions people ask (from the searches) that would make a good post.",
    "- hashtag_sets: brand (1-3 tags with the brand name), niche (5-8 specific to what it sells), local (2-5 with the city/area), broad (3-5 popular). Each starts with #, no spaces.",
    "Only use the brand's real services; never invent products or prices.",
    'Reply with JSON only: {"keywords": [{"phrase": "...", "intent": "learn", "cluster": "..."}], "questions": ["..."], "hashtag_sets": {"brand": ["#..."], "niche": ["#..."], "local": ["#..."], "broad": ["#..."]}}',
  ].join("\n");
}

const tag = (s: string) => {
  const t = s.trim().replace(/\s+/g, "").replace(/^#*/, "");
  return t ? `#${t}` : "";
};
const tags = z.array(z.string()).default([]).transform((a) => [...new Set(a.map(tag).filter(Boolean))].slice(0, 10));
const kitSchema = z.object({
  keywords: z
    .array(
      z.object({
        phrase: z.string(),
        intent: z.string().default("learn"),
        cluster: z.string().default("general"),
      }),
    )
    .default([]),
  questions: z.array(z.string()).default([]),
  hashtag_sets: z.object({ brand: tags, niche: tags, local: tags, broad: tags }).default({ brand: [], niche: [], local: [], broad: [] }),
});

const INTENTS = ["learn", "compare", "buy", "local"] as const;

export function normaliseKit(raw: unknown, suggestions: string[], now = new Date()): SeoKit {
  const k = kitSchema.parse(raw);
  return {
    keywords: k.keywords
      .map((w) => ({
        phrase: w.phrase.trim().toLowerCase().slice(0, 80),
        intent: (INTENTS as readonly string[]).includes(w.intent) ? (w.intent as SeoKit["keywords"][number]["intent"]) : "learn",
        cluster: w.cluster.trim().slice(0, 40) || "general",
      }))
      .filter((w) => w.phrase)
      .slice(0, 24),
    questions: k.questions.map((q) => q.trim()).filter(Boolean).slice(0, 10),
    hashtagSets: k.hashtag_sets,
    suggestions,
    generatedAt: now.toISOString(),
  };
}

/** Build and save the brand's SEO kit (one AI call). */
export async function buildSeoKit(workspaceId: number, brand: Brand): Promise<SeoKit> {
  const seeds = seoSeeds(brand);
  const lang = /hindi/i.test(brand.language) ? "hi" : /telugu/i.test(brand.language) ? "te" : "en";
  const suggestions = await gatherSuggestions(seeds, lang);
  const out = await generateText(
    { workspaceId, brandId: brand.id, purpose: "seo_kit", subject: { type: "brand", id: brand.id } },
    { system: brandSystemPrompt(brand), prompt: seoKitPrompt(seeds, suggestions), json: true, temperature: 0.4 },
  );
  const kit = normaliseKit(parseJsonObject(out.text), suggestions);
  const db = await getDb();
  await db.update(schema.brands).set({ seoKit: kit, updatedAt: new Date() }).where(and(eq(schema.brands.workspaceId, workspaceId), eq(schema.brands.id, brand.id)));
  return kit;
}

/** The newest "build SEO kit" job for a brand: is it still running, or did it fail? */
export async function seoJobState(workspaceId: number, brandId: number): Promise<{ running: boolean; error: string | null }> {
  const db = await getDb();
  const [job] = await db
    .select({ status: schema.jobs.status, error: schema.jobs.error })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.workspaceId, workspaceId), eq(schema.jobs.type, "brand.seo"), sql`${schema.jobs.payload}->>'brandId' = ${String(brandId)}`))
    .orderBy(desc(schema.jobs.id))
    .limit(1);
  if (!job) return { running: false, error: null };
  return { running: job.status === "queued" || job.status === "running", error: job.status === "failed" ? job.error : null };
}

export { seoKitLines } from "./seo-lines";
