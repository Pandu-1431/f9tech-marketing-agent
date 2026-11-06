import { z } from "zod";
import type { Brand, Campaign, Post } from "@/db/schema";
import { brandSystemPromptWithMemory } from "./brand-context";
import { campaignBriefLines } from "./planner";
import { parseJsonObject } from "./json";
import { generateText } from "./router";
import { isDemoProvider } from "@/lib/data";
import { CAPTION_RULES, capHashtags, HASHTAG_RULES } from "@/lib/formats";
import { isPosterTemplate, TEMPLATE_INFO } from "./images/poster-info";

const copySchema = z.object({
  caption: z.string().min(1),
  hashtags: z.array(z.string()).default([]),
  image_prompt: z.string().default(""),
  seo_keywords: z.array(z.string()).default([]),
  poster_headline: z.string().default(""),
  poster_cta: z.string().default(""),
  poster_subline: z.string().default(""),
  poster_kicker: z.string().default(""),
  poster_template: z.string().default(""),
});

/** Poster lines + template choice, shared by single and batch prompts. */
export function posterRules(): string[] {
  return [
    "POSTER (the image people see first; it must be clear in 1 second on a phone):",
    '- poster_headline: the main message, max 7 words, simple words (e.g. "199 days to Prelims 2027").',
    '- poster_subline: one short supporting sentence, max 12 words (e.g. "A daily plan sized to your free time."). Can be empty.',
    '- poster_kicker: tiny label above the headline, 1-3 words (e.g. "TIP", "PYQ 2023", "Day 12", "New"). Can be empty.',
    '- poster_cta: button text, 2-4 words (e.g. "Open the free app").',
    `- poster_template: pick the best layout: ${Object.entries(TEMPLATE_INFO).map(([id, t]) => `${id} = ${t.bestFor}`).join("; ")}. Vary templates across posts.`,
    "- image_prompt: ONE realistic photo for the background, set in India with Indian people and places where people appear (subject, setting, mood). Never ask for text in the image.",
  ];
}

const styleRules: Record<string, string> = {
  instagram: "Hook in the first line, short lines, 1-3 emojis, call to action.",
  facebook: "Conversational, clear call to action.",
  linkedin: "Professional, insight first, no emoji overload.",
  youtube: "First line = the video title, then the description with keywords early.",
  x: "Punchy, one idea.",
  google_business: "Google Business Profile update: local keywords and the city name, clear call to action.",
  telegram: "Telegram channel post: useful first line, short paragraphs, one clear link, few emojis.",
};

/** Style + length + hashtag rules for one platform, from the shared creative standards. */
export function platformRule(platform: string): string {
  const tags = HASHTAG_RULES[platform];
  const caption = CAPTION_RULES[platform];
  return [
    styleRules[platform] ?? "Clear, on-brand, with a call to action.",
    caption && `Length: ${caption.target}.`,
    tags && (tags.max === 0 ? "No hashtags." : `Hashtags: ${tags.min}-${tags.max} (${tags.note})`),
  ]
    .filter(Boolean)
    .join(" ");
}

/** Things to fix from a reviewer or the quality checker (empty = a fresh write). */
function fixLines(notes: string[] = []): string[] {
  const clean = notes.map((n) => n.trim()).filter(Boolean);
  return clean.length
    ? ["", "THIS IS A REWRITE. The last version had these problems; fix every one of them:", ...clean.map((n) => `- ${n}`), "Only use numbers that appear in the brand key facts or the campaign brief."]
    : [];
}

export function copyPrompt(campaign: Campaign, post: Post, notes: string[] = []): string {
  return [
    "TASK: POST_COPY",
    `CAMPAIGN THEME: ${campaign.theme}`,
    `CAMPAIGN GOAL: ${campaign.goal ?? "grow reach and enquiries"}`,
    ...campaignBriefLines(campaign),
    `PLATFORM: ${post.platform}`,
    `FORMAT: ${post.format}`,
    `PUBLISH DATE: ${post.publishOn}`,
    `POST ANGLE: ${post.angle ?? ""}`,
    "",
    `Platform rules: ${platformRule(post.platform)}`,
    "SEO/SMO: use 1-3 search keywords people would type for this, naturally, early in the text. seo_keywords = 4-8 phrases a person would search on Google, YouTube or the Play Store (mix short and long-tail, include the city or language when relevant).",
    ...ctaRules(campaign),
    ...posterRules(),
    ...fixLines(notes),
    'Reply with JSON only: {"caption": "...", "hashtags": ["#..."], "image_prompt": "...", "seo_keywords": ["..."], "poster_headline": "...", "poster_subline": "...", "poster_kicker": "...", "poster_cta": "...", "poster_template": "band"}',
  ].join("\n");
}

/** One post idea -> caption, hashtags, image prompt and SEO keywords. */
export async function writePostCopy(campaign: Campaign, brand: Brand, post: Post, opts: { notes?: string[]; memory?: string[] } = {}) {
  const out = await generateText(
    { workspaceId: post.workspaceId, brandId: brand.id, purpose: "post_copy", subject: { type: "post", id: post.id } },
    { system: await brandSystemPromptWithMemory(brand, opts.memory), prompt: copyPrompt(campaign, post, opts.notes), json: true, temperature: 0.85 },
  );
  const copy = copySchema.parse(parseJsonObject(out.text));
  return normalise(copy, campaign, post, isDemoProvider(out.provider));
}

/** CTA instructions from the campaign brief (empty when the campaign has none). */
function ctaRules(campaign: Campaign): string[] {
  return [
    campaign.callToAction && `End the caption with the call to action "${campaign.callToAction}". Use it as the poster CTA unless a shorter form is needed.`,
    campaign.ctaUrl && `Put the CTA link ${campaign.ctaUrl} in the caption (except Instagram: say "link in bio").`,
  ].filter((line): line is string => Boolean(line));
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
    ...campaignBriefLines(campaign),
    "",
    `Write the copy for each of these ${posts.length} posts. Each post must be different (new hook, new angle).`,
    ...posts.map(
      (p) =>
        `- id ${p.id} | platform ${p.platform} | format ${p.format} | date ${p.publishOn} | angle: ${p.angle ?? ""}\n  Platform rules: ${platformRule(p.platform)}`,
    ),
    "",
    "SEO/SMO: use 1-3 search keywords people would type for this, naturally, early in the text. seo_keywords = 4-8 phrases a person would search on Google, YouTube or the Play Store (mix short and long-tail, include the city or language when relevant).",
    ...ctaRules(campaign),
    ...posterRules(),
    'Reply with JSON only: {"posts": [{"id": 123, "caption": "...", "hashtags": ["#..."], "image_prompt": "...", "seo_keywords": ["..."], "poster_headline": "...", "poster_subline": "...", "poster_kicker": "...", "poster_cta": "...", "poster_template": "tip"}]}',
  ].join("\n");
}

type CopyResult = ReturnType<typeof normalise>;

function normalise(copy: z.infer<typeof copySchema>, campaign: Campaign, post: Post, demo: boolean) {
  // Campaign hashtags go first so the platform cap (e.g. 5 on Instagram) never drops them.
  const hashtags = capHashtags(post.platform, [...campaign.hashtags, ...copy.hashtags], post.format);
  const cta = copy.poster_cta || campaign.callToAction;
  return {
    caption: copy.caption.trim(),
    hashtags,
    imagePrompt: copy.image_prompt.trim(),
    seoKeywords: copy.seo_keywords.slice(0, 8),
    posterHeadline: (copy.poster_headline || campaign.theme).slice(0, 120),
    posterCta: cta ? cta.slice(0, 60) : null,
    posterSubline: copy.poster_subline.trim().slice(0, 160) || null,
    posterKicker: copy.poster_kicker.trim().slice(0, 40) || null,
    // Text-only formats have no poster; otherwise trust the model's pick when it is a real template.
    posterTemplate: isPosterTemplate(copy.poster_template.trim()) ? copy.poster_template.trim() : undefined,
    /** true when the built-in demo generator wrote it (not a real AI model). */
    demo,
  };
}

/** Writes several posts in one call. Returns a map of post id -> copy (missing ids = not written). */
export async function writePostsCopyBatch(campaign: Campaign, brand: Brand, posts: Post[], opts: { memory?: string[] } = {}): Promise<Map<number, CopyResult>> {
  const out = await generateText(
    { workspaceId: campaign.workspaceId, brandId: brand.id, purpose: "post_copy_batch", subject: { type: "campaign", id: campaign.id } },
    { system: await brandSystemPromptWithMemory(brand, opts.memory), prompt: batchPrompt(campaign, posts), json: true, temperature: 0.85 },
  );
  const parsed = batchSchema.parse(parseJsonObject(out.text));
  const byId = new Map(posts.map((p) => [p.id, p]));
  const result = new Map<number, CopyResult>();
  for (const c of parsed.posts) {
    const post = byId.get(c.id);
    if (post && c.caption) result.set(post.id, normalise(c, campaign, post, isDemoProvider(out.provider)));
  }
  return result;
}
