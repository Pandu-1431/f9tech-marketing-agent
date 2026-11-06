import crypto from "node:crypto";
import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

/*
 * Tracking links. Every link a post carries gets UTM tags (so Google Analytics shows which post and
 * channel sent the visitor). When the app has a public https address (APP_URL), the link also becomes
 * a short /r/<code> link that counts each click per post and channel before redirecting.
 * Running locally (http://localhost) nobody outside can open /r/..., so posts keep the tagged link.
 */

export function trackingBase(env: Record<string, string | undefined> = process.env): string | null {
  const app = (env.APP_URL ?? "").replace(/\/$/, "");
  return /^https:\/\//.test(app) ? app : null;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/** Adds utm_source / utm_medium / utm_campaign unless the link already has its own. */
export function withUtm(target: string, tags: { source: string; campaign?: string | null; content?: string | null }): string {
  let u: URL;
  try {
    u = new URL(target);
  } catch {
    return target;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return target;
  if (!u.searchParams.has("utm_source")) {
    u.searchParams.set("utm_source", slug(tags.source) || "social");
    u.searchParams.set("utm_medium", "social");
    if (tags.campaign) u.searchParams.set("utm_campaign", slug(tags.campaign));
    if (tags.content) u.searchParams.set("utm_content", slug(tags.content));
  }
  return u.toString();
}

function newCode(): string {
  return crypto.randomBytes(6).toString("base64url").slice(0, 8);
}

/** The link to put in a post: a counting short link when public, else the UTM-tagged target. */
export async function trackedUrl(input: {
  workspaceId: number;
  brandId: number;
  postId?: number | null;
  campaignId?: number | null;
  campaignTheme?: string | null;
  platform: string;
  target: string;
}): Promise<string> {
  const tagged = withUtm(input.target, { source: input.platform, campaign: input.campaignTheme, content: input.postId ? `post-${input.postId}` : null });
  const base = trackingBase();
  if (!base || !/^https?:\/\//i.test(input.target)) return tagged;
  const db = await getDb();
  if (input.postId) {
    const [existing] = await db
      .select()
      .from(schema.links)
      .where(and(eq(schema.links.workspaceId, input.workspaceId), eq(schema.links.postId, input.postId), eq(schema.links.platform, input.platform), eq(schema.links.target, tagged)));
    if (existing) return `${base}/r/${existing.code}`;
  }
  for (let i = 0; i < 3; i++) {
    try {
      const [row] = await db
        .insert(schema.links)
        .values({ workspaceId: input.workspaceId, brandId: input.brandId, postId: input.postId ?? null, campaignId: input.campaignId ?? null, platform: input.platform, code: newCode(), target: tagged })
        .returning();
      return `${base}/r/${row.code}`;
    } catch (err) {
      if (i === 2) throw err; // a code collision is retried with a new code
    }
  }
  return tagged;
}

/** A click on /r/<code>: count it and return where to send the visitor (null = unknown code). */
export async function recordClick(code: string): Promise<string | null> {
  if (!/^[\w-]{4,16}$/.test(code)) return null;
  const db = await getDb();
  const [link] = await db
    .update(schema.links)
    .set({ clicks: sql`${schema.links.clicks} + 1`, lastClickAt: new Date() })
    .where(eq(schema.links.code, code))
    .returning();
  if (!link) return null;
  await db.insert(schema.linkClicks).values({ linkId: link.id, workspaceId: link.workspaceId });
  return link.target;
}

/** Replace the business's links inside a caption with tracked ones (the first matching link only). */
export function swapLinks(text: string, targets: string[], tracked: string): string {
  for (const t of targets.filter(Boolean)) {
    const plain = t.replace(/\/$/, "");
    const re = new RegExp(`${plain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?(?=[\\s)]|$)`);
    if (re.test(text)) return text.replace(re, tracked);
  }
  return text;
}

/** Clicks per post (for the tracker and the Director). */
export async function clicksByPost(workspaceId: number, brandId?: number): Promise<Map<number, number>> {
  const db = await getDb();
  const rows = await db
    .select({ postId: schema.links.postId, clicks: sql<number>`sum(${schema.links.clicks})::int` })
    .from(schema.links)
    .where(brandId ? and(eq(schema.links.workspaceId, workspaceId), eq(schema.links.brandId, brandId)) : eq(schema.links.workspaceId, workspaceId))
    .groupBy(schema.links.postId);
  return new Map(rows.filter((r) => r.postId).map((r) => [r.postId!, Number(r.clicks)]));
}

/** Clicks for a brand since a time. */
export async function clicksSince(workspaceId: number, brandId: number, since: Date): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: count() })
    .from(schema.linkClicks)
    .innerJoin(schema.links, eq(schema.links.id, schema.linkClicks.linkId))
    .where(and(eq(schema.linkClicks.workspaceId, workspaceId), eq(schema.links.brandId, brandId), gte(schema.linkClicks.at, since)));
  return Number(row?.n ?? 0);
}

export async function topLinks(workspaceId: number, brandId: number, limit = 5) {
  const db = await getDb();
  return db.select().from(schema.links).where(and(eq(schema.links.workspaceId, workspaceId), eq(schema.links.brandId, brandId))).orderBy(desc(schema.links.clicks)).limit(limit);
}

export async function clicksBetween(workspaceId: number, brandId: number, from: Date, to: Date): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: count() })
    .from(schema.linkClicks)
    .innerJoin(schema.links, eq(schema.links.id, schema.linkClicks.linkId))
    .where(and(eq(schema.linkClicks.workspaceId, workspaceId), eq(schema.links.brandId, brandId), gte(schema.linkClicks.at, from), lt(schema.linkClicks.at, to)));
  return Number(row?.n ?? 0);
}
