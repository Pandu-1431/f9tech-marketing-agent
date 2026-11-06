import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Brand } from "@/db/schema";
import { decryptSecret } from "@/lib/secrets";
import { DEFAULT_TIMEZONE, isValidTimeZone, utcToZoned } from "@/lib/schedule";
import { replaceLearnings } from "../memory";
import { readMetrics } from "./fetch";
import { deriveLearnings, engagementScore, type Learning, type Metrics, type ScoredPost } from "./score";

/*
 * The Analyst = the 7th member of the AI team. Once a day per brand it:
 *   1. reads the results of every post published in the last 30 days (likes, comments,
 *      shares, saves, reach, views) from Facebook, Instagram and YouTube into post_metrics;
 *   2. scores each post and compares formats, platforms, posting times, poster layouts,
 *      caption hooks and lengths;
 *   3. writes what it found into the brand's memory as plain-English learnings.
 * The strategist, planner, copywriter and reel writer read that memory, so next week's
 * posts lean on what worked. No AI call is needed: it is arithmetic on real numbers.
 */

export const MIN_AGE_MS = 6 * 3600_000; // a post needs a few hours before its numbers mean anything
export const MAX_AGE_DAYS = 30; // numbers of older posts stop changing; stop re-reading them
export const LEARN_WINDOW_DAYS = 120; // learnings are drawn from this much history
export const RUN_EVERY_MS = 24 * 3600_000;

export type AnalystRun = { read: number; failed: number; learnings: Learning[] };

/** Read fresh numbers for every recent publication of a brand and save them. */
export async function readBrandResults(workspaceId: number, brandId: number, now = new Date()): Promise<{ read: number; failed: number }> {
  const db = await getDb();
  const rows = await db
    .select({ pub: schema.publications, channel: schema.channels, post: schema.posts })
    .from(schema.publications)
    .innerJoin(schema.posts, eq(schema.posts.id, schema.publications.postId))
    .innerJoin(schema.channels, eq(schema.channels.id, schema.publications.channelId))
    .where(
      and(
        eq(schema.publications.workspaceId, workspaceId),
        eq(schema.posts.brandId, brandId),
        eq(schema.publications.status, "sent"),
        lte(schema.publications.publishedAt, new Date(now.getTime() - MIN_AGE_MS)),
        gte(schema.publications.publishedAt, new Date(now.getTime() - MAX_AGE_DAYS * 86400000)),
      ),
    );
  let read = 0;
  let failed = 0;
  for (const { pub, channel, post } of rows) {
    if (!pub.externalId) continue;
    let m: Metrics | null;
    try {
      m = await readMetrics(pub.platform, { token: decryptSecret(channel.secret), config: channel.config }, pub.externalId);
    } catch {
      failed++;
      continue;
    }
    if (!m) continue; // platform cannot be measured (Telegram)
    const values = {
      workspaceId,
      brandId,
      postId: post.id,
      publicationId: pub.id,
      platform: pub.platform,
      impressions: m.impressions ?? 0,
      reach: m.reach ?? 0,
      likes: m.likes ?? 0,
      comments: m.comments ?? 0,
      shares: m.shares ?? 0,
      saves: m.saves ?? 0,
      views: m.views ?? 0,
      clicks: m.clicks ?? 0,
      score: engagementScore(m).toFixed(3),
      fetchedAt: now,
    };
    await db
      .insert(schema.postMetrics)
      .values(values)
      .onConflictDoUpdate({ target: schema.postMetrics.publicationId, set: { ...values, reads: sql`${schema.postMetrics.reads} + 1` } });
    read++;
  }
  return { read, failed };
}

/** Every measured post of the brand in the learning window, in the shape the maths needs. */
export async function scoredPosts(workspaceId: number, brandId: number, now = new Date()): Promise<ScoredPost[]> {
  const db = await getDb();
  const rows = await db
    .select({ m: schema.postMetrics, post: schema.posts, brand: schema.brands })
    .from(schema.postMetrics)
    .innerJoin(schema.posts, eq(schema.posts.id, schema.postMetrics.postId))
    .innerJoin(schema.brands, eq(schema.brands.id, schema.postMetrics.brandId))
    .where(and(eq(schema.postMetrics.workspaceId, workspaceId), eq(schema.postMetrics.brandId, brandId), gte(schema.postMetrics.fetchedAt, new Date(now.getTime() - LEARN_WINDOW_DAYS * 86400000))));
  return rows.map(({ m, post, brand }) => {
    const tz = isValidTimeZone(post.timezone) ? post.timezone : isValidTimeZone(brand.timezone) ? brand.timezone : DEFAULT_TIMEZONE;
    return {
      postId: post.id,
      platform: m.platform,
      format: post.format,
      template: post.format === "text" ? null : post.posterTemplate,
      time: post.scheduledAt ? utcToZoned(post.scheduledAt, tz).time : null,
      caption: post.caption,
      angle: post.angle,
      headline: post.posterHeadline,
      score: Number(m.score),
      metrics: { impressions: m.impressions, reach: m.reach, likes: m.likes, comments: m.comments, shares: m.shares, saves: m.saves, views: m.views, clicks: m.clicks },
    };
  });
}

/** One full Analyst run for a brand: read results, learn, remember. */
export async function runAnalyst(workspaceId: number, brandId: number, opts: { now?: Date } = {}): Promise<AnalystRun | null> {
  const now = opts.now ?? new Date();
  const db = await getDb();
  const [brand] = await db.select().from(schema.brands).where(and(eq(schema.brands.workspaceId, workspaceId), eq(schema.brands.id, brandId)));
  if (!brand) return null;
  const { read, failed } = await readBrandResults(workspaceId, brandId, now);
  const learnings = deriveLearnings(await scoredPosts(workspaceId, brandId, now));
  await replaceLearnings(workspaceId, brandId, learnings);
  await db.update(schema.brands).set({ analystLastRunAt: now }).where(eq(schema.brands.id, brandId));
  return { read, failed, learnings };
}

/** Called by the worker once a minute: queues a run for every brand with channels whose daily read is due. */
export async function queueDueAnalysts(now = new Date()): Promise<number> {
  const db = await getDb();
  const due = await db
    .selectDistinct({ id: schema.brands.id, workspaceId: schema.brands.workspaceId })
    .from(schema.brands)
    .innerJoin(schema.channels, eq(schema.channels.brandId, schema.brands.id))
    .where(or(isNull(schema.brands.analystLastRunAt), lte(schema.brands.analystLastRunAt, new Date(now.getTime() - RUN_EVERY_MS))));
  if (!due.length) return 0;
  const { enqueue } = await import("@/jobs/queue");
  for (const b of due) {
    // Book the run first, so a slow job never makes the same day run twice.
    await db.update(schema.brands).set({ analystLastRunAt: now }).where(eq(schema.brands.id, b.id));
    await enqueue("analyst.run", { workspaceId: b.workspaceId, brandId: b.id, at: now.toISOString() }, b.workspaceId);
  }
  return due.length;
}

/** The brand's latest numbers for the dashboard: top posts and totals (last 30 days). */
export async function brandResults(workspaceId: number, brandId: number, limit = 5) {
  const db = await getDb();
  const since = new Date(Date.now() - MAX_AGE_DAYS * 86400000);
  const rows = await db
    .select({ m: schema.postMetrics, post: { id: schema.posts.id, angle: schema.posts.angle, posterHeadline: schema.posts.posterHeadline, format: schema.posts.format, publishOn: schema.posts.publishOn } })
    .from(schema.postMetrics)
    .innerJoin(schema.posts, eq(schema.posts.id, schema.postMetrics.postId))
    .where(and(eq(schema.postMetrics.workspaceId, workspaceId), eq(schema.postMetrics.brandId, brandId), gte(schema.postMetrics.fetchedAt, since)))
    .orderBy(desc(schema.postMetrics.score))
    .limit(limit);
  return rows;
}

export type { Brand };
