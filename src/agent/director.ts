import { z } from "zod";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Brand, MarketingGoal, MarketingObjective, MarketingPlan, PlanWeek } from "@/db/schema";
import { CAMPAIGN_TYPE_KEYS } from "@/lib/campaign-types";
import { brandServices, brandSystemPromptWithMemory } from "./brand-context";
import { parseJsonObject } from "./json";
import { FORMATS } from "./planner";
import { generateText } from "./router";
import { datesThatMatter, nextRunAt, weekFor } from "./autopilot";
import { scoredPosts } from "./analyst";
import { remember } from "./memory";

/*
 * Marketing Director = the brain above the AI team.
 * A person sets a goal ("app installs", "50 leads a month"). The Director writes a four-week plan
 * (content pillars, one theme per week, formats, KPI targets) from the Brand Kit, past results,
 * the Analyst's learnings and the dates that matter. Every week the autopilot runs the plan's week,
 * and before that the Director reviews last week against the targets and adjusts (rules saved to
 * the brand's memory, so every agent follows them).
 */

export const OBJECTIVES: { key: MarketingObjective; label: string; hint: string }[] = [
  { key: "awareness", label: "Get known", hint: "Reach as many of the right people as possible" },
  { key: "followers", label: "Grow followers", hint: "People who follow and come back" },
  { key: "engagement", label: "Engagement", hint: "Likes, comments, shares, saves" },
  { key: "leads", label: "Enquiries / leads", hint: "Messages, calls, form sign-ups" },
  { key: "traffic", label: "Website visits", hint: "Clicks to the website" },
  { key: "installs", label: "App installs", hint: "Downloads of the app" },
  { key: "sales", label: "Sales / bookings", hint: "Orders, bookings, walk-ins" },
];

export function isObjective(v: unknown): v is MarketingObjective {
  return OBJECTIVES.some((o) => o.key === v);
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** The four plan weeks: from the brand's next autopilot week (or today's week when run now). */
export function planWeeks(brand: Pick<Brand, "autopilotDay" | "timezone">, now = new Date(), startNow = false): { start: string; end: string }[] {
  const first = startNow ? weekFor(brand, now) : weekFor(brand, nextRunAt(brand, new Date(now.getTime() - 1)));
  return [0, 1, 2, 3].map((i) => ({ start: addDays(first.start, i * 7), end: addDays(first.start, i * 7 + 6) }));
}

export type Performance = {
  posts: number;
  totals: { reach: number; likes: number; comments: number; shares: number; clicks: number; views: number };
  byFormat: { format: string; posts: number; avgScore: number }[];
  byPlatform: { platform: string; posts: number; avgScore: number }[];
  best: { angle: string; format: string; platform: string; score: number }[];
};

/** Last 30 days of measured posts, summed up for the Director (no AI). */
export async function performance(workspaceId: number, brandId: number, now = new Date(), days = 30): Promise<Performance> {
  const since = now.getTime() - days * 86400000;
  const all = (await scoredPosts(workspaceId, brandId, now)).filter((p) => p.postId);
  const db = await getDb();
  const recentIds = all.length
    ? new Set(
        (
          await db
            .select({ id: schema.posts.id })
            .from(schema.posts)
            .where(and(eq(schema.posts.workspaceId, workspaceId), inArray(schema.posts.id, all.map((p) => p.postId)), gte(schema.posts.updatedAt, new Date(since))))
        ).map((r) => r.id),
      )
    : new Set<number>();
  const posts = all.filter((p) => recentIds.has(p.postId));
  const group = (key: (p: (typeof posts)[number]) => string) => {
    const m = new Map<string, number[]>();
    for (const p of posts) m.set(key(p), [...(m.get(key(p)) ?? []), p.score]);
    return [...m.entries()].map(([k, v]) => ({ k, posts: v.length, avgScore: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 })).sort((a, b) => b.avgScore - a.avgScore);
  };
  const sum = (k: "reach" | "likes" | "comments" | "shares" | "clicks" | "views") => posts.reduce((a, p) => a + (p.metrics[k] ?? 0), 0);
  return {
    posts: posts.length,
    totals: { reach: sum("reach"), likes: sum("likes"), comments: sum("comments"), shares: sum("shares"), clicks: sum("clicks"), views: sum("views") },
    byFormat: group((p) => p.format).map((g) => ({ format: g.k, posts: g.posts, avgScore: g.avgScore })),
    byPlatform: group((p) => p.platform).map((g) => ({ platform: g.k, posts: g.posts, avgScore: g.avgScore })),
    best: [...posts].sort((a, b) => b.score - a.score).slice(0, 3).map((p) => ({ angle: p.angle ?? p.headline ?? "", format: p.format, platform: p.platform, score: p.score })),
  };
}

export function performanceLines(p: Performance): string[] {
  if (!p.posts) return ["PAST RESULTS: no measured posts yet (new account): plan to learn what works (mix formats)."];
  return [
    `PAST RESULTS (last 30 days, ${p.posts} measured posts): reach ${p.totals.reach}, likes ${p.totals.likes}, comments ${p.totals.comments}, shares ${p.totals.shares}, clicks ${p.totals.clicks}, video views ${p.totals.views}.`,
    p.byFormat.length ? `By format (avg engagement score): ${p.byFormat.map((f) => `${f.format} ${f.avgScore} (${f.posts})`).join(", ")}.` : "",
    p.byPlatform.length ? `By platform: ${p.byPlatform.map((f) => `${f.platform} ${f.avgScore} (${f.posts})`).join(", ")}.` : "",
    p.best.length ? `Best posts: ${p.best.map((b) => `"${b.angle}" (${b.format} on ${b.platform}, ${b.score})`).join("; ")}.` : "",
  ].filter(Boolean);
}

export function directorPlanPrompt(brand: Brand, goal: MarketingGoal, weeks: { start: string; end: string }[], perf: Performance, recentThemes: string[]): string {
  const services = brandServices(brand);
  const objective = OBJECTIVES.find((o) => o.key === goal.objective);
  const dates = datesThatMatter(brand, { start: weeks[0].start, end: weeks[3].end });
  const questions = brand.seoKit?.questions.slice(0, 6) ?? [];
  return [
    "TASK: MARKETING_PLAN",
    `GOAL: ${objective?.label ?? goal.objective} (${objective?.hint ?? ""})${goal.target ? `. Target: ${goal.target}` : ""}`,
    goal.focus ? `OWNER'S FOCUS: ${goal.focus}` : "",
    `POSTS PER WEEK: ${goal.postsPerWeek}`,
    services.length ? `SERVICES / FEATURES: ${services.join("; ")}` : "",
    `WEEKS: ${weeks.map((w, i) => `week ${i + 1} ${w.start} to ${w.end}`).join("; ")}`,
    dates.length ? `DATES THAT MATTER:\n${dates.map((d) => `- ${d}`).join("\n")}` : "DATES THAT MATTER: none",
    questions.length ? `QUESTIONS PEOPLE SEARCH: ${questions.join(" | ")}` : "",
    recentThemes.length ? `RECENT THEMES (do not repeat): ${recentThemes.join(" | ")}` : "",
    ...performanceLines(perf),
    "",
    "You are the brand's marketing director. Write a 4-week social media plan that moves the GOAL.",
    "- pillars: 3-4 content pillars with the share of posts (shares add up to 100) and one example post idea each.",
    "  Fit the goal: installs/leads/sales need more product and proof posts with a clear call to action; awareness/followers need more useful and shareable posts.",
    "- weeks: exactly 4, one theme each (max 10 words, specific), using dates that matter when they fit.",
    `  campaign_type: one of ${CAMPAIGN_TYPE_KEYS.join(", ")}. call_to_action: 2-5 words. formats: from ${FORMATS.join(", ")} (lean on what scored best in PAST RESULTS). why: one sentence.`,
    "- kpis: 3 weekly targets that can be counted (e.g. \"reach\" \"2,000 per week\", \"link clicks\" \"40 per week\"). Base numbers on PAST RESULTS (aim ~20% higher); for a new account give modest starter targets.",
    "- summary: 2 sentences: the strategy and why.",
    "- Only use facts from the brand key facts.",
    'Reply with JSON only: {"summary":"","pillars":[{"name":"","share":40,"example":""}],"weeks":[{"theme":"","campaign_type":"general","call_to_action":"","formats":["image","reel"],"why":""}],"kpis":[{"metric":"","target":""}]}',
  ]
    .filter(Boolean)
    .join("\n");
}

const planSchema = z.object({
  summary: z.string().default(""),
  pillars: z.array(z.object({ name: z.string(), share: z.coerce.number().default(25), example: z.string().default("") })).default([]),
  weeks: z
    .array(
      z.object({
        theme: z.string().min(3),
        campaign_type: z.string().default("general"),
        call_to_action: z.string().default(""),
        formats: z.array(z.string()).default([]),
        why: z.string().default(""),
      }),
    )
    .min(1),
  kpis: z.array(z.object({ metric: z.string(), target: z.coerce.string() })).default([]),
});

/** Write (or rewrite) the brand's four-week plan and save it. */
export async function makeMarketingPlan(workspaceId: number, brandId: number, opts: { now?: Date; startNow?: boolean } = {}): Promise<MarketingPlan> {
  const now = opts.now ?? new Date();
  const db = await getDb();
  const [brand] = await db.select().from(schema.brands).where(and(eq(schema.brands.workspaceId, workspaceId), eq(schema.brands.id, brandId)));
  if (!brand) throw new Error("Business not found");
  const goal = brand.marketingGoal ?? { objective: "awareness", target: "", focus: "", postsPerWeek: brand.autopilotPostsPerWeek };
  const weeks = planWeeks(brand, now, opts.startNow);
  const recent = await db.select({ theme: schema.campaigns.theme }).from(schema.campaigns).where(and(eq(schema.campaigns.workspaceId, workspaceId), eq(schema.campaigns.brandId, brandId))).orderBy(desc(schema.campaigns.id)).limit(6);
  const perf = await performance(workspaceId, brandId, now);
  const out = await generateText(
    { workspaceId, brandId, purpose: "marketing_plan" },
    { system: await brandSystemPromptWithMemory(brand), prompt: directorPlanPrompt(brand, goal, weeks, perf, recent.map((r) => r.theme)), json: true, temperature: 0.6 },
  );
  const p = planSchema.parse(parseJsonObject(out.text));
  const totalShare = p.pillars.reduce((a, x) => a + Math.max(0, x.share), 0) || 1;
  const plan: MarketingPlan = {
    summary: p.summary.slice(0, 600),
    pillars: p.pillars.slice(0, 5).map((x) => ({ name: x.name.slice(0, 60), share: Math.round((Math.max(0, x.share) / totalShare) * 100), example: x.example.slice(0, 200) })),
    weeks: weeks.map((w, i) => {
      const src = p.weeks[i] ?? p.weeks[i % p.weeks.length];
      const formats = src.formats.filter((f) => (FORMATS as readonly string[]).includes(f));
      return {
        ...w,
        theme: src.theme.slice(0, 200),
        campaignType: (CAMPAIGN_TYPE_KEYS as readonly string[]).includes(src.campaign_type) ? src.campaign_type : "general",
        callToAction: src.call_to_action.slice(0, 60),
        formats,
        why: src.why.slice(0, 300),
      };
    }),
    kpis: p.kpis.slice(0, 4).map((k) => ({ metric: k.metric.slice(0, 60), target: k.target.slice(0, 60) })),
    reviews: brand.marketingPlan?.reviews?.slice(-6) ?? [],
    generatedAt: now.toISOString(),
  };
  await db.update(schema.brands).set({ marketingPlan: plan, updatedAt: new Date() }).where(eq(schema.brands.id, brandId));
  return plan;
}

/** The plan's week for a run that starts on `start` (allows a few days' drift when run by hand). */
export function planWeekFor(plan: MarketingPlan | null | undefined, start: string): PlanWeek | null {
  if (!plan) return null;
  const t = Date.parse(start);
  return plan.weeks.find((w) => Math.abs(Date.parse(w.start) - t) <= 3 * 86400000) ?? null;
}

/** The plan has run out (its last week is over) and a new one is needed. */
export function planExpired(plan: MarketingPlan | null | undefined, weekStart: string): boolean {
  if (!plan?.weeks.length) return true;
  return plan.weeks.at(-1)!.end < weekStart;
}

const reviewSchema = z.object({ review: z.string().default(""), changes: z.array(z.string()).default([]) });

/** Last week's numbers for one plan week: posts made, published and their results. */
async function weekResults(workspaceId: number, brandId: number, week: PlanWeek) {
  const db = await getDb();
  const posts = await db
    .select({ id: schema.posts.id, status: schema.posts.status, format: schema.posts.format })
    .from(schema.posts)
    .where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.brandId, brandId), gte(schema.posts.publishOn, week.start), lte(schema.posts.publishOn, week.end)));
  const inWeek = posts;
  const ids = inWeek.map((p) => p.id);
  const metrics = ids.length ? await db.select().from(schema.postMetrics).where(and(eq(schema.postMetrics.workspaceId, workspaceId), inArray(schema.postMetrics.postId, ids))) : [];
  const sum = (k: "reach" | "likes" | "comments" | "shares" | "clicks" | "views") => metrics.reduce((a, m) => a + (Number(m[k]) || 0), 0);
  const from = new Date(`${week.start}T00:00:00Z`);
  const to = new Date(Date.parse(`${week.end}T00:00:00Z`) + 86400000);
  const { leadsBetween } = await import("@/lib/leads");
  const { clicksBetween } = await import("@/lib/links");
  return {
    leads: await leadsBetween(workspaceId, brandId, from, to),
    linkClicks: await clicksBetween(workspaceId, brandId, from, to),
    planned: inWeek.length,
    approved: inWeek.filter((p) => p.status === "approved" || p.status === "published").length,
    published: inWeek.filter((p) => p.status === "published").length,
    reach: sum("reach"), likes: sum("likes"), comments: sum("comments"), shares: sum("shares"), clicks: sum("clicks"), views: sum("views"),
  };
}

export function reviewPrompt(plan: MarketingPlan, week: PlanWeek, r: Awaited<ReturnType<typeof weekResults>>, perf: Performance): string {
  return [
    "TASK: WEEKLY_REVIEW",
    `LAST WEEK: ${week.start} to ${week.end}, theme "${week.theme}"`,
    `KPI TARGETS: ${plan.kpis.map((k) => `${k.metric}: ${k.target}`).join("; ") || "none"}`,
    `LAST WEEK'S NUMBERS: ${r.planned} posts planned, ${r.approved} approved, ${r.published} published; reach ${r.reach}, likes ${r.likes}, comments ${r.comments}, shares ${r.shares}, clicks ${r.clicks}, video views ${r.views}; tracked link clicks ${r.linkClicks}, new leads ${r.leads}.`,
    ...performanceLines(perf),
    "",
    "You are the marketing director. Review last week against the targets in 2-3 plain sentences (what worked, what did not, why).",
    "Then give at most 3 changes for the coming weeks, each a short instruction the team can follow in every post",
    '(e.g. "Make more reels: they got 2x the engagement", "Put the app link in the first line"). If posts were not approved or published, say so first.',
    'Reply with JSON only: {"review": "...", "changes": ["..."]}',
  ].join("\n");
}

/** Review the plan week that ended before `beforeStart` (once), save it, and teach the team its changes. */
export async function reviewLastWeek(workspaceId: number, brand: Brand, beforeStart: string, now = new Date()) {
  const plan = brand.marketingPlan;
  if (!plan) return null;
  const done = plan.weeks.filter((w) => w.end < beforeStart).at(-1);
  if (!done || plan.reviews.some((x) => x.week === done.start)) return null;
  const r = await weekResults(workspaceId, brand.id, done);
  const perf = await performance(workspaceId, brand.id, now);
  const out = await generateText(
    { workspaceId, brandId: brand.id, purpose: "weekly_review" },
    { system: await brandSystemPromptWithMemory(brand), prompt: reviewPrompt(plan, done, r, perf), json: true, temperature: 0.3 },
  );
  const rv = reviewSchema.parse(parseJsonObject(out.text));
  const changes = rv.changes.map((c) => c.trim().slice(0, 200)).filter(Boolean).slice(0, 3);
  const review = { week: done.start, at: now.toISOString(), text: rv.review.slice(0, 800), changes };
  const db = await getDb();
  await db.update(schema.brands).set({ marketingPlan: { ...plan, reviews: [...plan.reviews, review].slice(-8) } }).where(eq(schema.brands.id, brand.id));
  // The Director's newest changes replace its older ones in the brand's memory.
  await db
    .update(schema.memory)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(schema.memory.workspaceId, workspaceId), eq(schema.memory.brandId, brand.id), eq(schema.memory.source, "director"), eq(schema.memory.active, true)));
  for (const c of changes) await remember(workspaceId, brand.id, { kind: "learning", topic: "note", text: c, source: "director", weight: 2 });
  return review;
}

/**
 * Called by the autopilot before it plans a week: keeps the plan fresh, reviews the week that just ended,
 * and returns this week's plan entry (null = no goal set, the plain autopilot strategist decides).
 */
export async function directorWeek(workspaceId: number, brandId: number, week: { start: string; end: string }, now = new Date()): Promise<{ week: PlanWeek; goal: MarketingGoal } | null> {
  const db = await getDb();
  let [brand] = await db.select().from(schema.brands).where(eq(schema.brands.id, brandId));
  const goal = brand?.marketingGoal;
  if (!goal) return null;
  await reviewLastWeek(workspaceId, brand, week.start, now).catch(() => null);
  [brand] = await db.select().from(schema.brands).where(eq(schema.brands.id, brandId));
  let entry = planWeekFor(brand.marketingPlan, week.start);
  if (!entry || planExpired(brand.marketingPlan, week.start)) {
    const plan = await makeMarketingPlan(workspaceId, brandId, { now, startNow: true });
    entry = planWeekFor(plan, week.start) ?? plan.weeks[0];
  }
  return { week: entry, goal };
}

/** Is a plan being written for this brand right now (for the page's auto-refresh), or did the last try fail? */
export async function directorJobState(workspaceId: number, brandId: number): Promise<{ running: boolean; error: string | null }> {
  const db = await getDb();
  const [job] = await db
    .select({ status: schema.jobs.status, error: schema.jobs.error })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.workspaceId, workspaceId), inArray(schema.jobs.type, ["director.plan", "autopilot.run"]), sql`${schema.jobs.payload}->>'brandId' = ${String(brandId)}`))
    .orderBy(desc(schema.jobs.id))
    .limit(1);
  if (!job) return { running: false, error: null };
  return { running: job.status === "queued" || job.status === "running", error: job.status === "failed" ? job.error : null };
}

/** This plan's weeks with the campaign the autopilot made for each (if any). */
export async function planCampaigns(workspaceId: number, brandId: number, plan: MarketingPlan | null) {
  if (!plan) return new Map<string, { id: number; status: string }>();
  const db = await getDb();
  const rows = await db
    .select({ id: schema.campaigns.id, status: schema.campaigns.status, start: schema.campaigns.startDate })
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.workspaceId, workspaceId), eq(schema.campaigns.brandId, brandId), eq(schema.campaigns.source, "autopilot")))
    .orderBy(desc(schema.campaigns.id))
    .limit(20);
  // "Make this week's posts now" starts the week today, a few days before the plan week: match like planWeekFor.
  const out = new Map<string, { id: number; status: string }>();
  for (const w of plan.weeks) {
    const hit = rows.find((r) => Math.abs(Date.parse(r.start) - Date.parse(w.start)) <= 3 * 86400000);
    if (hit) out.set(w.start, { id: hit.id, status: hit.status });
  }
  return out;
}
