import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Channel } from "@/db/schema";
import { getFile, mimeFromKey, publicUrl } from "@/lib/storage";
import { isApprovedForPublish } from "@/lib/data";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { publishFacebook, publishInstagram, testFacebook, testInstagram } from "./meta";
import { publishTelegram, testTelegram } from "./telegram";
import { PublishConfigError, type ChannelAuth, type PublishInput, type PublishResult } from "./types";

/*
 * Publisher = the scheduler of the AI team. It sends ONLY the approved version of a post
 * (the frozen post_versions row), to the brand's connected channel for that platform,
 * at the post's scheduled time. A version is never sent twice to the same channel.
 */

export const CHANNEL_PLATFORMS = ["telegram", "facebook", "instagram"] as const;
export type ChannelPlatform = (typeof CHANNEL_PLATFORMS)[number];

const ADAPTERS: Record<ChannelPlatform, { test: (a: ChannelAuth) => Promise<string>; publish: (a: ChannelAuth, i: PublishInput) => Promise<PublishResult> }> = {
  telegram: { test: testTelegram, publish: publishTelegram },
  facebook: { test: testFacebook, publish: publishFacebook },
  instagram: { test: testInstagram, publish: publishInstagram },
};

export const isChannelPlatform = (p: string): p is ChannelPlatform => (CHANNEL_PLATFORMS as readonly string[]).includes(p);

/** Test the credentials, then save (or replace) the brand's channel for that platform. */
export async function connectChannel(workspaceId: number, brandId: number, platform: ChannelPlatform, token: string, config: Record<string, string>) {
  const name = await ADAPTERS[platform].test({ token, config });
  const db = await getDb();
  await db.delete(schema.channels).where(and(eq(schema.channels.workspaceId, workspaceId), eq(schema.channels.brandId, brandId), eq(schema.channels.platform, platform)));
  const [row] = await db.insert(schema.channels).values({ workspaceId, brandId, platform, name, config, secret: encryptSecret(token) }).returning();
  return row;
}

export async function listChannels(workspaceId: number, brandId: number) {
  const db = await getDb();
  return db.select().from(schema.channels).where(and(eq(schema.channels.workspaceId, workspaceId), eq(schema.channels.brandId, brandId)));
}

export async function removeChannel(workspaceId: number, channelId: number) {
  const db = await getDb();
  await db.delete(schema.channels).where(and(eq(schema.channels.workspaceId, workspaceId), eq(schema.channels.id, channelId)));
}

/** Absolute public link for a stored file, when one exists (Instagram needs it). */
function absoluteUrl(key: string): string | null {
  const u = publicUrl(key);
  if (/^https?:\/\//.test(u)) return u;
  return process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, "")}${u}` : null;
}

async function media(assetId: number | null) {
  if (!assetId) return null;
  const db = await getDb();
  const [a] = await db.select().from(schema.assets).where(eq(schema.assets.id, assetId));
  if (!a) return null;
  const data = await getFile(a.storageKey);
  return data ? { data, mime: a.mime || mimeFromKey(a.storageKey), publicUrl: absoluteUrl(a.storageKey) } : null;
}

/**
 * Queue the approved version of a post for its channel. Returns the publication, or a reason
 * it can't be queued. Safe to call many times: the same version is queued only once.
 */
export async function queuePublication(workspaceId: number, postId: number): Promise<{ publicationId?: number; reason?: string }> {
  const db = await getDb();
  const [post] = await db.select().from(schema.posts).where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.id, postId)));
  if (!post) return { reason: "Post not found" };
  if (!isApprovedForPublish(post)) return { reason: "Approve this version first" };
  const [channel] = await db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.workspaceId, workspaceId), eq(schema.channels.brandId, post.brandId), eq(schema.channels.platform, post.platform)));
  if (!channel) return { reason: `No ${post.platform} channel connected for this business` };
  const [row] = await db
    .insert(schema.publications)
    .values({ workspaceId, postId, channelId: channel.id, platform: post.platform, version: post.approvedVersion!, status: "queued" })
    .onConflictDoNothing()
    .returning();
  if (row) return { publicationId: row.id };
  const [existing] = await db
    .select()
    .from(schema.publications)
    .where(and(eq(schema.publications.postId, postId), eq(schema.publications.channelId, channel.id), eq(schema.publications.version, post.approvedVersion!)));
  return existing?.status === "failed" ? { publicationId: existing.id } : { reason: existing?.status === "sent" ? "Already published" : "Already queued" };
}

const MAX_ATTEMPTS = 3;

/** Send one queued publication. */
export async function sendPublication(workspaceId: number, publicationId: number): Promise<void> {
  const db = await getDb();
  // Claim it (queued or failed -> sending) so two workers never send the same thing.
  const [pub] = await db
    .update(schema.publications)
    .set({ status: "sending", attempts: sql`${schema.publications.attempts} + 1` })
    .where(and(eq(schema.publications.workspaceId, workspaceId), eq(schema.publications.id, publicationId), inArray(schema.publications.status, ["queued", "failed"])))
    .returning();
  if (!pub) return;
  const fail = async (error: string) => {
    await db.update(schema.publications).set({ status: "failed", error: error.slice(0, 1000) }).where(eq(schema.publications.id, pub.id));
  };
  try {
    const [channel] = pub.channelId ? await db.select().from(schema.channels).where(eq(schema.channels.id, pub.channelId)) : [];
    if (!channel) throw new PublishConfigError("The channel was removed.");
    const [version] = await db
      .select()
      .from(schema.postVersions)
      .where(and(eq(schema.postVersions.postId, pub.postId), eq(schema.postVersions.version, pub.version)));
    if (!version) throw new PublishConfigError("The approved version was not found.");
    const [post] = await db.select().from(schema.posts).where(eq(schema.posts.id, pub.postId));
    const text = [version.caption ?? "", version.hashtags.join(" ")].filter(Boolean).join("\n\n").trim();
    const video = post?.format === "reel" ? await media(version.videoAssetId) : null;
    const image = video || post?.format === "text" ? null : await media(version.posterAssetId);
    const result = await ADAPTERS[channel.platform as ChannelPlatform].publish({ token: decryptSecret(channel.secret), config: channel.config }, { text, image, video });
    await db
      .update(schema.publications)
      .set({ status: "sent", externalId: result.externalId, url: result.url, error: null, publishedAt: new Date() })
      .where(eq(schema.publications.id, pub.id));
    await db.update(schema.posts).set({ status: "published", updatedAt: new Date() }).where(eq(schema.posts.id, pub.postId));
    await db.update(schema.channels).set({ lastError: null }).where(eq(schema.channels.id, channel.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await fail(message);
    if (pub.channelId) await db.update(schema.channels).set({ lastError: message.slice(0, 500) }).where(eq(schema.channels.id, pub.channelId));
    // Network hiccups are retried by the job queue; config problems are not.
    if (!(err instanceof PublishConfigError) && pub.attempts < MAX_ATTEMPTS) throw err;
  }
}

/**
 * Called by the worker every minute: approved posts whose time has come (in the last 3 days)
 * and whose brand has a channel for that platform get queued and sent.
 */
export async function queueDuePublications(now = new Date()): Promise<number> {
  const db = await getDb();
  const due = await db
    .select({ post: schema.posts })
    .from(schema.posts)
    .innerJoin(schema.channels, and(eq(schema.channels.brandId, schema.posts.brandId), eq(schema.channels.platform, schema.posts.platform)))
    .where(
      and(
        eq(schema.posts.status, "approved"),
        isNotNull(schema.posts.scheduledAt),
        lte(schema.posts.scheduledAt, now),
        gte(schema.posts.scheduledAt, new Date(now.getTime() - 3 * 86400000)),
      ),
    );
  const { enqueue } = await import("@/jobs/queue");
  let n = 0;
  for (const { post } of due) {
    const q = await queuePublication(post.workspaceId, post.id);
    if (q.publicationId && !q.reason) {
      await enqueue("post.publish", { workspaceId: post.workspaceId, publicationId: q.publicationId }, post.workspaceId);
      n++;
    }
  }
  return n;
}

/** Latest publication per post in a campaign (for the post cards). */
export async function campaignPublications(workspaceId: number, campaignId: number) {
  const db = await getDb();
  const rows = await db
    .select({ p: schema.publications })
    .from(schema.publications)
    .innerJoin(schema.posts, eq(schema.posts.id, schema.publications.postId))
    .where(and(eq(schema.publications.workspaceId, workspaceId), eq(schema.posts.campaignId, campaignId)))
    .orderBy(desc(schema.publications.id));
  const byPost = new Map<number, typeof rows[number]["p"]>();
  for (const r of rows) if (!byPost.has(r.p.postId)) byPost.set(r.p.postId, r.p);
  return byPost;
}

export type { Channel };
