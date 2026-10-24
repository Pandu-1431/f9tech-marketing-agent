import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Brand, Campaign } from "@/db/schema";
import { freePlan } from "@/lib/config";
import { brandSystemPrompt } from "./brand-context";
import { parseJsonObject } from "./json";
import { generateText } from "./router";

export const PLATFORMS = ["instagram", "facebook", "linkedin", "youtube", "x", "google_business"] as const;
export const FORMATS = ["image", "carousel", "reel", "story", "text"] as const;

const planSchema = z.object({
  strategy: z.string().default(""),
  posts: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        platform: z.string(),
        format: z.string().default("image"),
        angle: z.string(),
      }),
    )
    .min(1),
});

export function targetPostCount(c: Pick<Campaign, "startDate" | "endDate" | "postsPerWeek" | "platforms">): number {
  const days = Math.round((Date.parse(c.endDate) - Date.parse(c.startDate)) / 86400000) + 1;
  const count = Math.ceil((days / 7) * c.postsPerWeek) * Math.max(1, c.platforms.length);
  return Math.max(1, Math.min(count, freePlan().maxPostsPerCampaign));
}

export function plannerPrompt(c: Campaign, postCount: number): string {
  return [
    "TASK: CAMPAIGN_PLAN",
    `THEME: ${c.theme}`,
    `GOAL: ${c.goal ?? "grow reach and enquiries"}`,
    `PLATFORMS: ${c.platforms.join(", ")}`,
    `START_DATE: ${c.startDate}`,
    `END_DATE: ${c.endDate}`,
    `POST_COUNT: ${postCount}`,
    "",
    "Plan a content calendar for this campaign.",
    `- Exactly ${postCount} posts, spread across the dates (inclusive), spread across the platforms.`,
    "- Vary the formats (image, carousel, reel, story, text) to suit each platform.",
    "- Build a story: awareness first, then value/offer, then urgency/reminder.",
    "- Each angle is one or two sentences: the specific idea of that post.",
    'Reply with JSON only: {"strategy": "2-3 sentences", "posts": [{"date": "YYYY-MM-DD", "platform": "instagram", "format": "image", "angle": "..."}]}',
  ].join("\n");
}

/** Theme -> calendar of post ideas, saved as posts with status "idea". */
export async function planCampaign(campaign: Campaign, brand: Brand) {
  const postCount = targetPostCount(campaign);
  const out = await generateText(
    { workspaceId: campaign.workspaceId, brandId: brand.id, purpose: "campaign_plan", subject: { type: "campaign", id: campaign.id } },
    { system: brandSystemPrompt(brand), prompt: plannerPrompt(campaign, postCount), json: true, temperature: 0.7 },
  );

  const plan = planSchema.parse(parseJsonObject(out.text));
  const allowed = new Set(campaign.platforms);
  const picked = plan.posts.slice(0, postCount);
  const span = Math.round((Date.parse(campaign.endDate) - Date.parse(campaign.startDate)) / 86400000);
  const evenDate = (i: number) =>
    new Date(Date.parse(campaign.startDate) + Math.round((span * i) / Math.max(1, picked.length - 1)) * 86400000)
      .toISOString()
      .slice(0, 10);

  const rows = picked.map((p, i) => {
    // Keep dates inside the campaign window (spread evenly if the model went outside it)
    // and platforms inside the chosen list.
    const date = p.date < campaign.startDate || p.date > campaign.endDate ? evenDate(i) : p.date;
    const platform = allowed.has(p.platform) ? p.platform : campaign.platforms[i % campaign.platforms.length];
    const format = (FORMATS as readonly string[]).includes(p.format) ? p.format : "image";
    return {
      workspaceId: campaign.workspaceId,
      campaignId: campaign.id,
      brandId: brand.id,
      platform,
      format,
      publishOn: date,
      angle: p.angle,
      status: "idea",
    };
  });

  const db = await getDb();
  await db.insert(schema.posts).values(rows);
  return { strategy: plan.strategy, count: rows.length };
}
