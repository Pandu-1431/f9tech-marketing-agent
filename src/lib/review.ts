import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Asset, Post } from "@/db/schema";

/*
 * The review queue: every post across all campaigns that a person can approve right now.
 * Client reviewers land here instead of digging through each campaign.
 * Ready = written (version > 0), status "drafted", no demo parts, poster/video not being made.
 * Posts changed after an earlier approval come back here too (their status returns to "drafted").
 */

export type ReviewItem = {
  post: Post;
  brandName: string;
  campaignId: number;
  campaignTheme: string;
  poster: Asset | null;
  video: Asset | null;
  /** The version a person approved before this change, if any ("changed after approval"). */
  previouslyApproved: number | null;
};

const ready = (workspaceId: number) =>
  and(
    eq(schema.posts.workspaceId, workspaceId),
    eq(schema.posts.status, "drafted"),
    gt(schema.posts.currentVersion, 0),
    sql`jsonb_array_length(${schema.posts.demoParts}) = 0`,
    sql`${schema.posts.designStatus} <> 'designing'`,
    sql`${schema.posts.reelStatus} <> 'making'`,
  );

/** How many posts wait for a decision (the nav badge). */
export async function reviewCount(workspaceId: number): Promise<number> {
  const db = await getDb();
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.posts).where(ready(workspaceId));
  return Number(row?.n ?? 0);
}

/** Posts waiting for review, soonest publish date first (unscheduled last). */
export async function reviewQueue(workspaceId: number, opts: { brandId?: number; limit?: number } = {}): Promise<ReviewItem[]> {
  const db = await getDb();
  const rows = await db
    .select({ post: schema.posts, brandName: schema.brands.name, campaignTheme: schema.campaigns.theme })
    .from(schema.posts)
    .innerJoin(schema.brands, eq(schema.brands.id, schema.posts.brandId))
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.posts.campaignId))
    .where(opts.brandId ? and(ready(workspaceId), eq(schema.posts.brandId, opts.brandId)) : ready(workspaceId))
    .orderBy(sql`${schema.posts.scheduledAt} asc nulls last`, asc(schema.posts.id))
    .limit(opts.limit ?? 50);
  if (!rows.length) return [];

  const ids = rows.map((r) => r.post.id);
  const assets = await db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.workspaceId, workspaceId), inArray(schema.assets.postId, ids), inArray(schema.assets.kind, ["poster", "video"])))
    .orderBy(desc(schema.assets.id));
  const latest = new Map<string, Asset>();
  for (const a of assets) {
    const k = `${a.kind}:${a.postId}`;
    if (!latest.has(k)) latest.set(k, a);
  }

  return rows.map((r) => ({
    post: r.post,
    brandName: r.brandName,
    campaignId: r.post.campaignId,
    campaignTheme: r.campaignTheme,
    poster: latest.get(`poster:${r.post.id}`) ?? null,
    video: latest.get(`video:${r.post.id}`) ?? null,
    previouslyApproved: r.post.approvedVersion,
  }));
}
