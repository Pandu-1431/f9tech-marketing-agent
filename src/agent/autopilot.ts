import { z } from "zod";
import { and, desc, eq, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Brand } from "@/db/schema";
import { createCampaign, setCampaignStatus } from "@/lib/data";
import { CAMPAIGN_TYPE_KEYS } from "@/lib/campaign-types";
import { DEFAULT_TIMEZONE, isValidTimeZone, utcToZoned, zonedToUtc } from "@/lib/schedule";
import { brandServices, brandSystemPromptWithMemory } from "./brand-context";
import { parseJsonObject } from "./json";
import { allowedFormats, FORMATS } from "./planner";
import { datesIn } from "./quality";
import { generateText, QuotaExceededError } from "./router";
import { TrialEndedError } from "@/lib/plan";

/*
 * Weekly autopilot = the strategist + manager of the AI team.
 * On the brand's chosen day it picks the week's theme (from the Brand Kit, its services,
 * dates that matter and what was posted recently), creates the week's campaign and starts
 * the normal pipeline: plan -> write -> design -> quality check -> reels.
 * A person only approves the posts.
 */

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const RUN_TIME = "06:00"; // local time the week is planned

/** Fixed-date Indian national days and observances (month-day). Lunar festivals change every year, so they are not listed. */
export const OBSERVANCES: { md: string; name: string }[] = [
  { md: "01-12", name: "National Youth Day (Swami Vivekananda Jayanti)" },
  { md: "01-24", name: "National Girl Child Day" },
  { md: "01-25", name: "National Voters' Day" },
  { md: "01-26", name: "Republic Day" },
  { md: "02-28", name: "National Science Day" },
  { md: "03-08", name: "International Women's Day" },
  { md: "04-14", name: "Dr B.R. Ambedkar Jayanti" },
  { md: "04-21", name: "Civil Services Day" },
  { md: "05-01", name: "Labour Day" },
  { md: "06-05", name: "World Environment Day" },
  { md: "06-21", name: "International Yoga Day" },
  { md: "08-15", name: "Independence Day" },
  { md: "08-29", name: "National Sports Day" },
  { md: "09-05", name: "Teachers' Day" },
  { md: "09-14", name: "Hindi Diwas" },
  { md: "10-02", name: "Gandhi Jayanti" },
  { md: "10-31", name: "National Unity Day" },
  { md: "11-14", name: "Children's Day" },
  { md: "11-26", name: "Constitution Day" },
  { md: "12-23", name: "Kisan Diwas (Farmers' Day)" },
];

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const tzOf = (brand: Pick<Brand, "timezone">) => (isValidTimeZone(brand.timezone) ? brand.timezone : DEFAULT_TIMEZONE);

/** The next time the autopilot should run for this brand: the chosen weekday at 06:00 local, strictly after `now`. */
export function nextRunAt(brand: Pick<Brand, "autopilotDay" | "timezone">, now = new Date()): Date {
  const tz = tzOf(brand);
  const today = utcToZoned(now, tz).date;
  for (let i = 0; i <= 7; i++) {
    const date = addDays(today, i);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const at = zonedToUtc(date, RUN_TIME, tz);
    if (weekday === brand.autopilotDay && at.getTime() > now.getTime()) return at;
  }
  return zonedToUtc(addDays(today, 7), RUN_TIME, tz);
}

/** The 7 days the run covers: the run day and the 6 after it (local dates). */
export function weekFor(brand: Pick<Brand, "timezone">, runAt: Date): { start: string; end: string } {
  const start = utcToZoned(runAt, tzOf(brand)).date;
  return { start, end: addDays(start, 6) };
}

/** Observances inside the week, and the brand's own key dates coming up (for countdowns). */
export function datesThatMatter(brand: Pick<Brand, "keyFacts">, week: { start: string; end: string }): string[] {
  const out: string[] = [];
  for (let d = week.start; d <= week.end; d = addDays(d, 1)) {
    for (const o of OBSERVANCES) if (d.slice(5) === o.md) out.push(`${d}: ${o.name}`);
  }
  const startDay = Math.round(Date.parse(week.start) / 86400000);
  for (const day of datesIn(brand.keyFacts ?? "")) {
    const gap = day - startDay;
    if (gap >= 0 && gap <= 365) out.push(`${new Date(day * 86400000).toISOString().slice(0, 10)}: a key date from the brand's key facts (${gap} days after the week starts)`);
  }
  return out;
}

const themeSchema = z.object({
  theme: z.string().min(3),
  goal: z.string().default(""),
  campaign_type: z.string().default("general"),
  call_to_action: z.string().default(""),
  why: z.string().default(""),
});

export function strategistPrompt(brand: Brand, week: { start: string; end: string }, recentThemes: string[]): string {
  const services = brandServices(brand);
  const dates = datesThatMatter(brand, week);
  return [
    "TASK: WEEKLY_THEME",
    `WEEK: ${week.start} to ${week.end}`,
    services.length ? `SERVICES / FEATURES: ${services.join("; ")}` : "",
    dates.length ? `DATES THAT MATTER:\n${dates.map((d) => `- ${d}`).join("\n")}` : "DATES THAT MATTER: none this week",
    recentThemes.length ? `RECENT WEEKS' THEMES (do not repeat): ${recentThemes.join(" | ")}` : "",
    "",
    "You are the brand's marketing strategist. Pick ONE theme for this week's social media posts.",
    "- Use a date that matters if one fits the brand (a national day, or a countdown to a key date).",
    "- Otherwise pick a service/feature or an audience problem that has not had a recent week.",
    "- The theme is short and specific (max 10 words), e.g. \"Prelims countdown: 199 days, start your daily plan\".",
    `- campaign_type: one of ${CAMPAIGN_TYPE_KEYS.join(", ")}.`,
    "- call_to_action: 2-5 words, what readers should do.",
    'Reply with JSON only: {"theme": "...", "goal": "one sentence", "campaign_type": "general", "call_to_action": "...", "why": "one sentence"}',
  ]
    .filter(Boolean)
    .join("\n");
}

/** Plans and starts one week for a brand. Safe to call twice: a week already planned is not planned again. */
export async function runAutopilot(workspaceId: number, brandId: number, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const db = await getDb();
  const [brand] = await db.select().from(schema.brands).where(and(eq(schema.brands.workspaceId, workspaceId), eq(schema.brands.id, brandId)));
  if (!brand) return null;

  // The week starts on the run day (today when run by hand on another day).
  const week = weekFor(brand, now);
  const [existing] = await db
    .select()
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.workspaceId, workspaceId), eq(schema.campaigns.brandId, brandId), eq(schema.campaigns.source, "autopilot"), eq(schema.campaigns.startDate, week.start)));
  if (existing) return existing;

  const recent = await db
    .select({ theme: schema.campaigns.theme })
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.workspaceId, workspaceId), eq(schema.campaigns.brandId, brandId)))
    .orderBy(desc(schema.campaigns.id))
    .limit(6);

  // Marketing Director: when the business has a goal, the week comes from the Director's plan.
  const { directorWeek } = await import("./director");
  const directed = await directorWeek(workspaceId, brandId, week, now).catch((err) => {
    if (err instanceof QuotaExceededError || err instanceof TrialEndedError) throw err;
    return null;
  });

  let pick: z.infer<typeof themeSchema>;
  if (directed) {
    pick = { theme: directed.week.theme, goal: `Goal: ${directed.goal.objective}${directed.goal.target ? ` (${directed.goal.target})` : ""}.`, campaign_type: directed.week.campaignType, call_to_action: directed.week.callToAction, why: directed.week.why };
  } else try {
    const out = await generateText(
      { workspaceId, brandId, purpose: "weekly_theme" },
      { system: await brandSystemPromptWithMemory(brand), prompt: strategistPrompt(brand, week, recent.map((r) => r.theme)), json: true, temperature: 0.7 },
    );
    pick = themeSchema.parse(parseJsonObject(out.text));
  } catch (err) {
    // Strategist unavailable (or out of quota): rotate through the brand's services instead.
    if (err instanceof QuotaExceededError || err instanceof TrialEndedError) throw err;
    const services = brandServices(brand);
    const weekNo = Math.floor(Date.parse(week.start) / (7 * 86400000));
    pick = { theme: services.length ? `This week: ${services[weekNo % services.length]}` : `This week at ${brand.name}`, goal: "", campaign_type: "general", call_to_action: "", why: "" };
  }

  const platforms = (brand.autopilotPlatforms.length ? brand.autopilotPlatforms : brand.platforms).filter(Boolean);
  const planFormats = directed?.week.formats.filter((f) => (FORMATS as readonly string[]).includes(f)) ?? [];
  const formats = allowedFormats({ formats: planFormats.length ? planFormats : brand.autopilotFormats.filter((f) => (FORMATS as readonly string[]).includes(f)) });
  const campaign = await createCampaign(workspaceId, {
    brandId,
    theme: pick.theme.slice(0, 300),
    goal: [pick.goal, pick.why && `Why this week: ${pick.why}`].filter(Boolean).join(" ") || null,
    platforms: platforms.length ? platforms : ["instagram"],
    startDate: week.start,
    endDate: week.end,
    postsPerWeek: Math.max(1, Math.min(14, directed?.goal.postsPerWeek ?? brand.autopilotPostsPerWeek)),
    campaignType: (CAMPAIGN_TYPE_KEYS as readonly string[]).includes(pick.campaign_type) ? pick.campaign_type : "general",
    callToAction: pick.call_to_action.trim().slice(0, 60) || null,
    ctaUrl: brand.website,
    formats,
  });
  await db.update(schema.campaigns).set({ source: "autopilot" }).where(eq(schema.campaigns.id, campaign.id));
  await setCampaignStatus(workspaceId, campaign.id, "planning");
  const { enqueue } = await import("@/jobs/queue");
  await enqueue("campaign.plan", { workspaceId, campaignId: campaign.id }, workspaceId);
  await db.update(schema.brands).set({ autopilotLastRunAt: now }).where(eq(schema.brands.id, brandId));
  return { ...campaign, source: "autopilot" };
}

/** Called by the worker: queues a run for every brand whose day has come, and books its next run. */
export async function queueDueAutopilots(now = new Date()): Promise<number> {
  const db = await getDb();
  const due = await db
    .select()
    .from(schema.brands)
    .where(and(eq(schema.brands.autopilotEnabled, true), lte(schema.brands.autopilotNextRunAt, now)));
  const { enqueue } = await import("@/jobs/queue");
  for (const brand of due) {
    // Book the next run first, so a slow job never makes the same week run twice.
    await db.update(schema.brands).set({ autopilotNextRunAt: nextRunAt(brand, now) }).where(eq(schema.brands.id, brand.id));
    await enqueue("autopilot.run", { workspaceId: brand.workspaceId, brandId: brand.id, at: now.toISOString() }, brand.workspaceId);
  }
  return due.length;
}
