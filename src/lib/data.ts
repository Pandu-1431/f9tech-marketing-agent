import { and, asc, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { DEFAULT_TIMEZONE, isHhMm, isIsoDate, isValidTimeZone, slotFor, utcToZoned, zonedToUtc } from "./schedule";
import { getDb, schema } from "@/db";
import type { NewBrand } from "@/db/schema";
import { freePlan } from "./config";

/*
 * Data access layer. Every function takes the workspaceId and filters by it,
 * so one customer can never read or change another customer's data.
 */

export class LimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitError";
  }
}

// ---------- Brands ----------

export async function listBrands(workspaceId: number) {
  const db = await getDb();
  return db.select().from(schema.brands).where(eq(schema.brands.workspaceId, workspaceId)).orderBy(asc(schema.brands.name));
}

export async function getBrand(workspaceId: number, id: number) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.brands)
    .where(and(eq(schema.brands.workspaceId, workspaceId), eq(schema.brands.id, id)));
  return row ?? null;
}

export async function countBrands(workspaceId: number) {
  const db = await getDb();
  const [row] = await db.select({ n: count() }).from(schema.brands).where(eq(schema.brands.workspaceId, workspaceId));
  return Number(row?.n ?? 0);
}

type BrandInput = Omit<NewBrand, "id" | "workspaceId" | "createdAt" | "updatedAt">;

export async function createBrand(workspaceId: number, input: BrandInput) {
  const max = freePlan().maxBrands;
  if ((await countBrands(workspaceId)) >= max) {
    throw new LimitError(`The free plan allows ${max} business accounts per workspace.`);
  }
  const db = await getDb();
  const [row] = await db
    .insert(schema.brands)
    .values({ ...input, workspaceId })
    .returning();
  return row;
}

export async function updateBrand(workspaceId: number, id: number, input: BrandInput) {
  const db = await getDb();
  const [row] = await db
    .update(schema.brands)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(schema.brands.workspaceId, workspaceId), eq(schema.brands.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteBrand(workspaceId: number, id: number) {
  const db = await getDb();
  await db.delete(schema.brands).where(and(eq(schema.brands.workspaceId, workspaceId), eq(schema.brands.id, id)));
}

// ---------- Campaigns ----------

export async function listCampaigns(workspaceId: number) {
  const db = await getDb();
  return db
    .select({ campaign: schema.campaigns, brandName: schema.brands.name })
    .from(schema.campaigns)
    .innerJoin(schema.brands, eq(schema.brands.id, schema.campaigns.brandId))
    .where(eq(schema.campaigns.workspaceId, workspaceId))
    .orderBy(desc(schema.campaigns.createdAt));
}

export async function getCampaign(workspaceId: number, id: number) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.workspaceId, workspaceId), eq(schema.campaigns.id, id)));
  return row ?? null;
}

export async function createCampaign(
  workspaceId: number,
  input: {
    brandId: number;
    theme: string;
    goal?: string | null;
    platforms: string[];
    startDate: string;
    endDate: string;
    postsPerWeek: number;
    campaignType?: string;
    audience?: string | null;
    keyFacts?: string | null;
    eventDate?: string | null;
    location?: string | null;
    callToAction?: string | null;
    ctaUrl?: string | null;
    language?: string | null;
    hashtags?: string[];
    formats?: string[];
  },
) {
  const brand = await getBrand(workspaceId, input.brandId);
  if (!brand) throw new LimitError("Brand not found in this workspace.");
  const db = await getDb();
  const [row] = await db
    .insert(schema.campaigns)
    .values({ ...input, workspaceId, status: "draft" })
    .returning();
  return row;
}

export async function setCampaignStatus(workspaceId: number, id: number, status: string, extra: { error?: string | null; strategy?: string | null } = {}) {
  const db = await getDb();
  await db
    .update(schema.campaigns)
    .set({ status, ...extra })
    .where(and(eq(schema.campaigns.workspaceId, workspaceId), eq(schema.campaigns.id, id)));
}

// ---------- Posts ----------

export async function listCampaignPosts(workspaceId: number, campaignId: number) {
  const db = await getDb();
  return db
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.campaignId, campaignId)))
    .orderBy(asc(schema.posts.publishOn), asc(schema.posts.scheduledAt), asc(schema.posts.id));
}

export async function getPost(workspaceId: number, id: number) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.id, id)));
  return row ?? null;
}

export async function updatePost(
  workspaceId: number,
  id: number,
  values: Partial<Pick<typeof schema.posts.$inferInsert, "caption" | "hashtags" | "imagePrompt" | "seoKeywords" | "status" | "reviewNote" | "posterHeadline" | "posterCta" | "posterTemplate" | "designStatus" | "reelStatus" | "reelError">>,
) {
  const db = await getDb();
  const [row] = await db
    .update(schema.posts)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.id, id)))
    .returning();
  return row ?? null;
}

// ---------- Demo content ----------

/** Provider names of the built-in demo generators (no real AI). */
export const DEMO_PROVIDERS = new Set(["fake"]);
export const isDemoProvider = (provider: string | null | undefined) => Boolean(provider && DEMO_PROVIDERS.has(provider));

export type DemoPart = "text" | "image" | "video";

/** Adds or removes one demo marker on a post (atomic, keeps the other markers). */
export async function setDemoPart(workspaceId: number, postId: number, part: DemoPart, on: boolean) {
  const db = await getDb();
  await db
    .update(schema.posts)
    .set({
      demoParts: on
        ? sql`(SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb) FROM jsonb_array_elements_text(${schema.posts.demoParts} || ${JSON.stringify([part])}::jsonb) AS x)`
        : sql`${schema.posts.demoParts} - ${part}::text`,
    })
    .where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.id, postId)));
}

export class DemoContentError extends Error {
  constructor() {
    super("This post contains demo content (not made by a real AI model) and cannot be approved. Regenerate it with a real AI provider, or edit the caption yourself.");
    this.name = "DemoContentError";
  }
}

// ---------- Versions and approval ----------

export type VersionReason = "caption" | "ai_write" | "ai_rewrite" | "poster" | "reel";

export class StaleVersionError extends Error {
  constructor() {
    super("This post changed while you were reviewing it. Check the latest version and approve again.");
    this.name = "StaleVersionError";
  }
}

export class BusyPostError extends Error {
  constructor() {
    super("The poster or video for this post is still being made. Approve it when it is ready.");
    this.name = "BusyPostError";
  }
}

/**
 * Saves the post's current caption + latest poster/video as a new frozen version.
 * Call after EVERY change to what would be published. If the post was approved or
 * rejected, it goes back to "drafted" (needs review): an approval covers one version only.
 */
export async function recordPostVersion(workspaceId: number, postId: number, reason: VersionReason, userId: number | null = null) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [post] = await tx
      .update(schema.posts)
      .set({
        currentVersion: sql`${schema.posts.currentVersion} + 1`,
        status: sql`CASE WHEN ${schema.posts.status} IN ('approved', 'rejected') THEN 'drafted' ELSE ${schema.posts.status} END`,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.id, postId)))
      .returning();
    if (!post) return null;
    const latest = async (kind: "poster" | "video") => {
      const [a] = await tx
        .select({ id: schema.assets.id })
        .from(schema.assets)
        .where(and(eq(schema.assets.workspaceId, workspaceId), eq(schema.assets.postId, postId), eq(schema.assets.kind, kind)))
        .orderBy(desc(schema.assets.id))
        .limit(1);
      return a?.id ?? null;
    };
    const [version] = await tx
      .insert(schema.postVersions)
      .values({
        workspaceId,
        postId,
        version: post.currentVersion,
        reason,
        caption: post.caption,
        hashtags: post.hashtags,
        imagePrompt: post.imagePrompt,
        posterHeadline: post.posterHeadline,
        posterCta: post.posterCta,
        posterAssetId: await latest("poster"),
        videoAssetId: await latest("video"),
        demoParts: post.demoParts,
        createdBy: userId,
      })
      .returning();
    return version;
  });
}

/**
 * Approve or reject one version of a post.
 * - `version` is the version the reviewer was looking at; if the post has changed since, StaleVersionError.
 * - Approval is refused while any part is demo content, or while a poster/video is still being made.
 * Every decision is logged in `approvals` with who, when and which version.
 */
export async function reviewPost(
  workspaceId: number,
  postId: number,
  decision: "approved" | "rejected",
  note: string | null,
  by: { userId: number | null; version: number },
) {
  const post = await getPost(workspaceId, postId);
  if (!post) return null;
  if (post.currentVersion < 1 || post.status === "idea") throw new StaleVersionError();
  if (by.version !== post.currentVersion) throw new StaleVersionError();
  if (decision === "approved") {
    if (post.demoParts.length > 0) throw new DemoContentError();
    if (post.designStatus === "designing" || post.reelStatus === "making") throw new BusyPostError();
  }
  const db = await getDb();
  return db.transaction(async (tx) => {
    // Conditional update: only if nobody changed the post in the meantime.
    const [row] = await tx
      .update(schema.posts)
      .set({ status: decision, reviewNote: note, approvedVersion: decision === "approved" ? by.version : null, updatedAt: new Date() })
      .where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.id, postId), eq(schema.posts.currentVersion, by.version)))
      .returning();
    if (!row) throw new StaleVersionError();
    await tx.insert(schema.approvals).values({ workspaceId, postId, version: by.version, decision, note, userId: by.userId });
    return row;
  });
}

/** True only when the post is approved AND nothing changed since. Publishing must check this. */
export function isApprovedForPublish(post: { status: string; currentVersion: number; approvedVersion: number | null }) {
  return post.status === "approved" && post.approvedVersion !== null && post.approvedVersion === post.currentVersion;
}

/** Version history and approval log for the campaign page. */
export async function postHistory(workspaceId: number, postId: number) {
  const db = await getDb();
  const versions = await db
    .select({ v: schema.postVersions, by: schema.users.name })
    .from(schema.postVersions)
    .leftJoin(schema.users, eq(schema.users.id, schema.postVersions.createdBy))
    .where(and(eq(schema.postVersions.workspaceId, workspaceId), eq(schema.postVersions.postId, postId)))
    .orderBy(desc(schema.postVersions.version));
  const reviews = await db
    .select({ a: schema.approvals, by: schema.users.name })
    .from(schema.approvals)
    .leftJoin(schema.users, eq(schema.users.id, schema.approvals.userId))
    .where(and(eq(schema.approvals.workspaceId, workspaceId), eq(schema.approvals.postId, postId)))
    .orderBy(desc(schema.approvals.id));
  return {
    versions: versions.map((r) => ({ ...r.v, byName: r.by })),
    reviews: reviews.map((r) => ({ ...r.a, byName: r.by })),
  };
}

/** Version history and approval log for every post in a campaign, newest first (one query each). */
export async function campaignHistory(workspaceId: number, campaignId: number) {
  const db = await getDb();
  const versions = await db
    .select({ id: schema.postVersions.id, postId: schema.postVersions.postId, version: schema.postVersions.version, reason: schema.postVersions.reason, createdAt: schema.postVersions.createdAt, by: schema.users.name })
    .from(schema.postVersions)
    .innerJoin(schema.posts, eq(schema.posts.id, schema.postVersions.postId))
    .leftJoin(schema.users, eq(schema.users.id, schema.postVersions.createdBy))
    .where(and(eq(schema.postVersions.workspaceId, workspaceId), eq(schema.posts.campaignId, campaignId)))
    .orderBy(desc(schema.postVersions.version));
  const reviews = await db
    .select({ a: schema.approvals, by: schema.users.name })
    .from(schema.approvals)
    .innerJoin(schema.posts, eq(schema.posts.id, schema.approvals.postId))
    .leftJoin(schema.users, eq(schema.users.id, schema.approvals.userId))
    .where(and(eq(schema.approvals.workspaceId, workspaceId), eq(schema.posts.campaignId, campaignId)))
    .orderBy(desc(schema.approvals.id));
  type Entry = { key: string; at: Date; version: number; kind: "version" | "approved" | "rejected"; label: string; by: string | null; note: string | null };
  const byPost = new Map<number, Entry[]>();
  const push = (postId: number, e: Entry) => byPost.set(postId, [...(byPost.get(postId) ?? []), e]);
  for (const v of versions) push(v.postId, { key: `v${v.id}`, at: v.createdAt, version: v.version, kind: "version", label: VERSION_LABELS[v.reason] ?? v.reason, by: v.by, note: null });
  for (const r of reviews) push(r.a.postId, { key: `a${r.a.id}`, at: r.a.createdAt, version: r.a.version, kind: r.a.decision as "approved" | "rejected", label: r.a.decision === "approved" ? "Approved" : "Rejected", by: r.by, note: r.a.note });
  for (const list of byPost.values()) list.sort((x, y) => y.at.getTime() - x.at.getTime() || (x.kind === "version" ? 1 : -1));
  return byPost;
}

const VERSION_LABELS: Record<string, string> = {
  caption: "Caption edited",
  ai_write: "AI wrote the caption",
  ai_rewrite: "AI rewrote the caption",
  poster: "New poster",
  reel: "New reel video",
  backfill: "Saved before version tracking",
};

// ---------- Dashboard ----------

export async function postStatusCounts(workspaceId: number) {
  const db = await getDb();
  const rows = await db
    .select({ status: schema.posts.status, n: count() })
    .from(schema.posts)
    .where(eq(schema.posts.workspaceId, workspaceId))
    .groupBy(schema.posts.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])) as Record<string, number>;
}

export async function recentGenerations(workspaceId: number, limit = 20) {
  const db = await getDb();
  return db
    .select({
      id: schema.generations.id,
      purpose: schema.generations.purpose,
      provider: schema.generations.provider,
      model: schema.generations.model,
      status: schema.generations.status,
      durationMs: schema.generations.durationMs,
      createdAt: schema.generations.createdAt,
    })
    .from(schema.generations)
    .where(eq(schema.generations.workspaceId, workspaceId))
    .orderBy(desc(schema.generations.createdAt))
    .limit(limit);
}

// ---------- Assets ----------

/** Latest poster for each post in a campaign. */
export async function latestPosters(workspaceId: number, campaignId: number) {
  const db = await getDb();
  const rows = await db
    .select({ asset: schema.assets })
    .from(schema.assets)
    .innerJoin(schema.posts, eq(schema.posts.id, schema.assets.postId))
    .where(and(eq(schema.assets.workspaceId, workspaceId), eq(schema.posts.campaignId, campaignId), eq(schema.assets.kind, "poster")))
    .orderBy(desc(schema.assets.id));
  const byPost = new Map<number, (typeof rows)[number]["asset"]>();
  for (const r of rows) if (r.asset.postId && !byPost.has(r.asset.postId)) byPost.set(r.asset.postId, r.asset);
  return byPost;
}

export async function listAssets(workspaceId: number, kind?: string, limit = 120) {
  const db = await getDb();
  return db
    .select({ asset: schema.assets, brandName: schema.brands.name })
    .from(schema.assets)
    .leftJoin(schema.brands, eq(schema.brands.id, schema.assets.brandId))
    .where(kind ? and(eq(schema.assets.workspaceId, workspaceId), eq(schema.assets.kind, kind)) : eq(schema.assets.workspaceId, workspaceId))
    .orderBy(desc(schema.assets.id))
    .limit(limit);
}

export async function setBrandLogo(workspaceId: number, brandId: number, logoKey: string) {
  const db = await getDb();
  await db
    .update(schema.brands)
    .set({ logoKey, updatedAt: new Date() })
    .where(and(eq(schema.brands.workspaceId, workspaceId), eq(schema.brands.id, brandId)));
}

/** Latest reel video for each post in a campaign. */
export async function latestVideos(workspaceId: number, campaignId: number) {
  const db = await getDb();
  const rows = await db
    .select({ asset: schema.assets })
    .from(schema.assets)
    .innerJoin(schema.posts, eq(schema.posts.id, schema.assets.postId))
    .where(and(eq(schema.assets.workspaceId, workspaceId), eq(schema.posts.campaignId, campaignId), eq(schema.assets.kind, "video")))
    .orderBy(desc(schema.assets.id));
  const byPost = new Map<number, (typeof rows)[number]["asset"]>();
  for (const r of rows) if (r.asset.postId && !byPost.has(r.asset.postId)) byPost.set(r.asset.postId, r.asset);
  return byPost;
}

// ---------- Calendar and scheduling ----------

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleError";
  }
}

/**
 * Move a post to another local date and/or time (in the post's own time zone).
 * The schedule is not part of the approved content, so approval stays. Published posts can't move.
 */
export async function reschedulePost(workspaceId: number, postId: number, to: { date: string; time?: string }) {
  if (!isIsoDate(to.date)) throw new ScheduleError("Pick a valid date");
  if (to.time !== undefined && !isHhMm(to.time)) throw new ScheduleError("Pick a valid time");
  const post = await getPost(workspaceId, postId);
  if (!post) return null;
  if (post.status === "published") throw new ScheduleError("This post is already published.");
  const tz = isValidTimeZone(post.timezone) ? post.timezone : DEFAULT_TIMEZONE;
  const time = to.time ?? (post.scheduledAt ? utcToZoned(post.scheduledAt, tz).time : slotFor(post.platform));
  const db = await getDb();
  const [row] = await db
    .update(schema.posts)
    .set({ publishOn: to.date, scheduledAt: zonedToUtc(to.date, time, tz), updatedAt: new Date() })
    .where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.id, postId)))
    .returning();
  return row ?? null;
}

/** Every post between two local dates (inclusive), across campaigns and brands, with names and the latest poster. */
export async function calendarPosts(workspaceId: number, range: { from: string; to: string; brandId?: number }) {
  const db = await getDb();
  const conds = [eq(schema.posts.workspaceId, workspaceId), gte(schema.posts.publishOn, range.from), lte(schema.posts.publishOn, range.to)];
  if (range.brandId) conds.push(eq(schema.posts.brandId, range.brandId));
  const rows = await db
    .select({ post: schema.posts, campaignTheme: schema.campaigns.theme, brandName: schema.brands.name })
    .from(schema.posts)
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.posts.campaignId))
    .innerJoin(schema.brands, eq(schema.brands.id, schema.posts.brandId))
    .where(and(...conds))
    .orderBy(asc(schema.posts.scheduledAt), asc(schema.posts.id))
    .limit(1000);
  const ids = rows.map((r) => r.post.id);
  const posters = new Map<number, string>();
  if (ids.length > 0) {
    const assets = await db
      .select({ postId: schema.assets.postId, key: schema.assets.storageKey })
      .from(schema.assets)
      .where(and(eq(schema.assets.workspaceId, workspaceId), eq(schema.assets.kind, "poster"), inArray(schema.assets.postId, ids)))
      .orderBy(desc(schema.assets.id));
    for (const a of assets) if (a.postId && !posters.has(a.postId)) posters.set(a.postId, a.key);
  }
  return rows.map((r) => ({ ...r.post, campaignTheme: r.campaignTheme, brandName: r.brandName, posterKey: posters.get(r.post.id) ?? null }));
}
