import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { deleteFiles } from "./storage";

/*
 * Deleting media (an AI image, poster, video, logo, product screenshot) and whole campaigns.
 * The rows go and the files are removed from storage, so the space is freed. References are
 * cleaned up (a brand's logo, a post's chosen video); a post's history keeps its text.
 */

/** Media that a post still waiting to go out would lose (the delete button asks first). */
export async function assetsInUse(workspaceId: number, assetIds: number[]): Promise<Set<number>> {
  if (!assetIds.length) return new Set();
  const db = await getDb();
  const rows = await db
    .select({ id: schema.assets.id })
    .from(schema.assets)
    .innerJoin(schema.posts, eq(schema.posts.id, schema.assets.postId))
    .where(and(eq(schema.assets.workspaceId, workspaceId), inArray(schema.assets.id, assetIds), inArray(schema.assets.kind, ["poster", "video"]), inArray(schema.posts.status, ["drafted", "approved"])));
  return new Set(rows.map((r) => r.id));
}

export async function deleteAssets(workspaceId: number, ids: number[]): Promise<number> {
  if (!ids.length) return 0;
  const db = await getDb();
  const rows = await db.select().from(schema.assets).where(and(eq(schema.assets.workspaceId, workspaceId), inArray(schema.assets.id, ids)));
  if (!rows.length) return 0;
  const keys = rows.map((r) => r.storageKey);
  await db.transaction(async (tx) => {
    // A logo or presenter photo in use by a business: the business simply has none afterwards.
    await tx.update(schema.brands).set({ logoKey: null }).where(and(eq(schema.brands.workspaceId, workspaceId), inArray(schema.brands.logoKey, keys)));
    await tx.update(schema.brands).set({ presenter: null }).where(and(eq(schema.brands.workspaceId, workspaceId), inArray(sql`${schema.brands.presenter}->>'faceKey'`, keys)));
    await tx.update(schema.posts).set({ videoChoice: null }).where(and(eq(schema.posts.workspaceId, workspaceId), inArray(schema.posts.videoChoice, rows.map((r) => r.id))));
    await tx.delete(schema.assets).where(and(eq(schema.assets.workspaceId, workspaceId), inArray(schema.assets.id, rows.map((r) => r.id))));
  });
  await deleteFiles(keys.filter((k) => k.startsWith(`ws${workspaceId}/`))).catch(() => 0);
  return rows.length;
}

/** Delete a campaign, its posts and their media files (published posts stay on the platforms). */
export async function deleteCampaign(workspaceId: number, campaignId: number): Promise<{ posts: number; files: number } | null> {
  const db = await getDb();
  const [campaign] = await db.select({ id: schema.campaigns.id }).from(schema.campaigns).where(and(eq(schema.campaigns.workspaceId, workspaceId), eq(schema.campaigns.id, campaignId)));
  if (!campaign) return null;
  const posts = await db.select({ id: schema.posts.id, cover: sql<string | null>`${schema.posts.reelScript}->>'coverKey'` }).from(schema.posts).where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.campaignId, campaignId)));
  const postIds = posts.map((p) => p.id);
  const assets = postIds.length ? await db.select({ key: schema.assets.storageKey }).from(schema.assets).where(and(eq(schema.assets.workspaceId, workspaceId), inArray(schema.assets.postId, postIds))) : [];
  const keys = [...new Set([...assets.map((a) => a.key), ...posts.map((p) => p.cover ?? "")])].filter((k) => k.startsWith(`ws${workspaceId}/`));
  await db.transaction(async (tx) => {
    await tx.delete(schema.jobs).where(and(eq(schema.jobs.workspaceId, workspaceId), sql`(${schema.jobs.payload}->>'campaignId') = ${String(campaignId)}`));
    if (postIds.length) await tx.delete(schema.jobs).where(and(eq(schema.jobs.workspaceId, workspaceId), inArray(sql`(${schema.jobs.payload}->>'postId')`, postIds.map(String))));
    // Posts (and their versions, approvals, publications, results, media rows) go with the campaign.
    await tx.delete(schema.campaigns).where(and(eq(schema.campaigns.workspaceId, workspaceId), eq(schema.campaigns.id, campaignId)));
  });
  const files = await deleteFiles(keys).catch(() => 0);
  return { posts: postIds.length, files };
}
