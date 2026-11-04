import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Brand, Campaign } from "@/db/schema";
import { campaignArc, campaignTypeLabel } from "@/lib/campaign-types";
import { freePlan } from "@/lib/config";
import { brandServices, brandSystemPrompt } from "./brand-context";
import { DEFAULT_TIMEZONE, isHhMm, isValidTimeZone, slotFor, zonedToUtc } from "@/lib/schedule";
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
        time: z.string().optional(),
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

/** The formats this campaign may use (all of them when none are set). */
export function allowedFormats(c: Pick<Campaign, "formats">): string[] {
  const picked = (c.formats ?? []).filter((f) => (FORMATS as readonly string[]).includes(f));
  return picked.length ? picked : [...FORMATS];
}

/** The campaign brief lines shared by the planner and copywriter prompts (only the parts that are set). */
export function campaignBriefLines(c: Campaign): string[] {
  return [
    `CAMPAIGN_TYPE: ${campaignTypeLabel(c.campaignType)}`,
    c.audience && `AUDIENCE: ${c.audience}`,
    c.eventDate && `EVENT_DATE: ${c.eventDate}`,
    c.location && `LOCATION: ${c.location}`,
    c.keyFacts && `KEY FACTS (the only facts, numbers, dates and contacts you may use):\n${c.keyFacts}`,
    c.callToAction && `CALL TO ACTION: ${c.callToAction}`,
    c.ctaUrl && `CTA LINK: ${c.ctaUrl}`,
    c.language && `LANGUAGE: ${c.language} (overrides the brand language)`,
    c.hashtags.length > 0 && `CAMPAIGN HASHTAGS (use in every post): ${c.hashtags.join(" ")}`,
  ].filter((line): line is string => Boolean(line));
}

export function plannerPrompt(c: Campaign, postCount: number, brand?: Pick<Brand, "services">): string {
  const formats = allowedFormats(c);
  const services = brand ? brandServices(brand) : [];
  return [
    "TASK: CAMPAIGN_PLAN",
    `THEME: ${c.theme}`,
    `GOAL: ${c.goal ?? "grow reach and enquiries"}`,
    ...campaignBriefLines(c),
    `PLATFORMS: ${c.platforms.join(", ")}`,
    `FORMATS: ${formats.join(", ")}`,
    `START_DATE: ${c.startDate}`,
    `END_DATE: ${c.endDate}`,
    `POST_COUNT: ${postCount}`,
    services.length > 0 && `SERVICES: ${services.join("; ")}`,
    "",
    "Plan a content calendar for this campaign.",
    `- Exactly ${postCount} posts, spread across the dates (inclusive), spread across the platforms.`,
    `- Use only these formats: ${formats.join(", ")}. Vary them to suit each platform.`,
    `- ${campaignArc(c.campaignType)}`,
    services.length > 0 &&
      "- Spread the posts across the SERVICES that fit the theme, so each fitting service gets attention; name the service in the angle.",
    "- Each angle is one or two sentences: the specific idea of that post.",
    '- "time" is the local posting time (HH:MM, 24h) when the audience of that platform is most active; leave it out if unsure.',
    'Reply with JSON only: {"strategy": "2-3 sentences", "posts": [{"date": "YYYY-MM-DD", "time": "19:00", "platform": "instagram", "format": "image", "angle": "..."}]}',
  ]
    .filter((line): line is string => line !== false)
    .join("\n");
}

/** Theme -> calendar of post ideas, saved as posts with status "idea". */
export async function planCampaign(campaign: Campaign, brand: Brand) {
  const postCount = targetPostCount(campaign);
  const out = await generateText(
    { workspaceId: campaign.workspaceId, brandId: brand.id, purpose: "campaign_plan", subject: { type: "campaign", id: campaign.id } },
    { system: brandSystemPrompt(brand), prompt: plannerPrompt(campaign, postCount, brand), json: true, temperature: 0.7 },
  );

  const plan = planSchema.parse(parseJsonObject(out.text));
  const allowed = new Set(campaign.platforms);
  const formats = allowedFormats(campaign);
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
    const format = formats.includes(p.format) ? p.format : formats[i % formats.length];
    const timezone = isValidTimeZone(brand.timezone) ? brand.timezone : DEFAULT_TIMEZONE;
    const time = p.time && isHhMm(p.time) ? p.time : slotFor(platform);
    return {
      workspaceId: campaign.workspaceId,
      campaignId: campaign.id,
      brandId: brand.id,
      platform,
      format,
      publishOn: date,
      scheduledAt: zonedToUtc(date, time, timezone),
      timezone,
      angle: p.angle,
      status: "idea",
    };
  });

  const db = await getDb();
  await db.insert(schema.posts).values(rows);
  return { strategy: plan.strategy, count: rows.length };
}
