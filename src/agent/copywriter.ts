import { z } from "zod";
import type { Brand, Campaign, Post } from "@/db/schema";
import { brandSystemPrompt } from "./brand-context";
import { parseJsonObject } from "./json";
import { generateText } from "./router";

const copySchema = z.object({
  caption: z.string().min(1),
  hashtags: z.array(z.string()).default([]),
  image_prompt: z.string().default(""),
  seo_keywords: z.array(z.string()).default([]),
  poster_headline: z.string().default(""),
  poster_cta: z.string().default(""),
});

const platformRules: Record<string, string> = {
  instagram: "Hook in the first line, 80-150 words, short lines, 1-3 emojis, call to action, 8-15 relevant hashtags.",
  facebook: "Conversational, 60-120 words, clear call to action, 2-5 hashtags.",
  linkedin: "Professional, insight first, 100-200 words, no emoji overload, 3-5 hashtags.",
  youtube: "Write a video title (under 70 chars) as the first line, then a description of 100-150 words with keywords early, 3-5 hashtags.",
  x: "Under 260 characters including hashtags, punchy, 1-2 hashtags.",
  google_business: "Google Business Profile update: 80-150 words, local keywords and city name, clear call to action, no hashtags.",
};

export function copyPrompt(campaign: Campaign, post: Post): string {
  return [
    "TASK: POST_COPY",
    `CAMPAIGN THEME: ${campaign.theme}`,
    `CAMPAIGN GOAL: ${campaign.goal ?? "grow reach and enquiries"}`,
    `PLATFORM: ${post.platform}`,
    `FORMAT: ${post.format}`,
    `PUBLISH DATE: ${post.publishOn}`,
    `POST ANGLE: ${post.angle ?? ""}`,
    "",
    `Platform rules: ${platformRules[post.platform] ?? "Clear, on-brand, with a call to action."}`,
    "SEO/SMO: use 1-3 search keywords people would type for this, naturally, early in the text.",
    "Poster headline: the short offer/message printed on the image, max 7 words (e.g. \"Diwali Gift Boxes 20% Off\"). Poster CTA: 2-3 words (e.g. \"Order Now\").",
    "Image prompt: describe one on-brand visual (subject, setting, brand colours, mood, composition) for an AI image model. No text in the image unless essential.",
    'Reply with JSON only: {"caption": "...", "hashtags": ["#..."], "image_prompt": "...", "seo_keywords": ["..."], "poster_headline": "...", "poster_cta": "..."}',
  ].join("\n");
}

/** One post idea -> caption, hashtags, image prompt and SEO keywords. */
export async function writePostCopy(campaign: Campaign, brand: Brand, post: Post) {
  const out = await generateText(
    { workspaceId: post.workspaceId, brandId: brand.id, purpose: "post_copy", subject: { type: "post", id: post.id } },
    { system: brandSystemPrompt(brand), prompt: copyPrompt(campaign, post), json: true, temperature: 0.85 },
  );
  const copy = copySchema.parse(parseJsonObject(out.text));
  const hashtags = Array.from(
    new Set(copy.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`).replace(/\s+/g, ""))),
  ).slice(0, 20);
  return {
    caption: copy.caption.trim(),
    hashtags: post.platform === "google_business" ? [] : hashtags,
    imagePrompt: copy.image_prompt.trim(),
    seoKeywords: copy.seo_keywords.slice(0, 8),
    posterHeadline: (copy.poster_headline || campaign.theme).slice(0, 120),
    posterCta: copy.poster_cta ? copy.poster_cta.slice(0, 60) : null,
  };
}

// ---------- Batch mode: several posts in one AI call (much faster, fewer requests) ----------

const batchSchema = z.object({
  posts: z.array(copySchema.extend({ id: z.coerce.number() })).min(1),
});

export function batchPrompt(campaign: Campaign, posts: Post[]): string {
  return [
    "TASK: POST_COPY_BATCH",
    `CAMPAIGN THEME: ${campaign.theme}`,
    `CAMPAIGN GOAL: ${campaign.goal ?? "grow reach and enquiries"}`,
    "",
    `Write the copy for each of these ${posts.length} posts. Each post must be different (new hook, new angle).`,
    ...posts.map(
      (p) =>
        `- id ${p.id} | platform ${p.platform} | format ${p.format} | date ${p.publishOn} | angle: ${p.angle ?? ""}\n  Platform rules: ${platformRules[p.platform] ?? "Clear, on-brand, with a call to action."}`,
    ),
    "",
    "SEO/SMO: use 1-3 search keywords people would type for this, naturally, early in the text.",
    'Poster headline: max 7 words printed on the image (e.g. "Diwali Gift Boxes 20% Off"). Poster CTA: 2-3 words (e.g. "Order Now").',
    "Image prompt: one on-brand visual (subject, setting, brand colours, mood). No text in the image.",
    'Reply with JSON only: {"posts": [{"id": 123, "caption": "...", "hashtags": ["#..."], "image_prompt": "...", "seo_keywords": ["..."], "poster_headline": "...", "poster_cta": "..."}]}',
  ].join("\n");
}

type CopyResult = Awaited<ReturnType<typeof writePostCopy>>;

function normalise(copy: z.infer<typeof copySchema>, campaign: Campaign, post: Post): CopyResult {
  const hashtags = Array.from(new Set(copy.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`).replace(/\s+/g, "")))).slice(0, 20);
  return {
    caption: copy.caption.trim(),
    hashtags: post.platform === "google_business" ? [] : hashtags,
    imagePrompt: copy.image_prompt.trim(),
    seoKeywords: copy.seo_keywords.slice(0, 8),
    posterHeadline: (copy.poster_headline || campaign.theme).slice(0, 120),
    posterCta: copy.poster_cta ? copy.poster_cta.slice(0, 60) : null,
  };
}

/** Writes several posts in one call. Returns a map of post id -> copy (missing ids = not written). */
export async function writePostsCopyBatch(campaign: Campaign, brand: Brand, posts: Post[]): Promise<Map<number, CopyResult>> {
  const out = await generateText(
    { workspaceId: campaign.workspaceId, brandId: brand.id, purpose: "post_copy_batch", subject: { type: "campaign", id: campaign.id } },
    { system: brandSystemPrompt(brand), prompt: batchPrompt(campaign, posts), json: true, temperature: 0.85 },
  );
  const parsed = batchSchema.parse(parseJsonObject(out.text));
  const byId = new Map(posts.map((p) => [p.id, p]));
  const result = new Map<number, CopyResult>();
  for (const c of parsed.posts) {
    const post = byId.get(c.id);
    if (post && c.caption) result.set(post.id, normalise(c, campaign, post));
  }
  return result;
}
