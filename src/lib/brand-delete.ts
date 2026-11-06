import { and, count, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { deleteFiles } from "./storage";

/*
 * Deleting a business account for good: everything in the database (campaigns, posts, versions,
 * approvals, publications, results, leads, articles, comments, memory, channels…) goes with the
 * brand row (foreign keys cascade), then its files are removed from storage to free the space.
 */

export type Footprint = { campaigns: number; posts: number; published: number; files: number; bytes: number; leads: number; articles: number; comments: number; channels: number };

export async function brandFootprint(workspaceId: number, brandId: number): Promise<Footprint> {
  const db = await getDb();
  const n = async (table: typeof schema.campaigns | typeof schema.posts | typeof schema.leads | typeof schema.articles | typeof schema.comments | typeof schema.channels) => {
    const [r] = await db.select({ n: count() }).from(table).where(and(eq(table.workspaceId, workspaceId), eq(table.brandId, brandId)));
    return Number(r?.n ?? 0);
  };
  const [files] = await db
    .select({ n: count(), bytes: sql<number>`coalesce(sum(${schema.assets.bytes}), 0)::bigint` })
    .from(schema.assets)
    .where(and(eq(schema.assets.workspaceId, workspaceId), eq(schema.assets.brandId, brandId)));
  const [published] = await db
    .select({ n: count() })
    .from(schema.posts)
    .where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.brandId, brandId), eq(schema.posts.status, "published")));
  return {
    campaigns: await n(schema.campaigns),
    posts: await n(schema.posts),
    published: Number(published?.n ?? 0),
    files: Number(files?.n ?? 0),
    bytes: Number(files?.bytes ?? 0),
    leads: await n(schema.leads),
    articles: await n(schema.articles),
    comments: await n(schema.comments),
    channels: await n(schema.channels),
  };
}

/** Every stored file that belongs to the business (assets, logo, presenter face, article covers). */
export async function brandFileKeys(workspaceId: number, brandId: number): Promise<string[]> {
  const db = await getDb();
  const assets = await db.select({ key: schema.assets.storageKey }).from(schema.assets).where(and(eq(schema.assets.workspaceId, workspaceId), eq(schema.assets.brandId, brandId)));
  const covers = await db.select({ key: schema.articles.coverKey }).from(schema.articles).where(and(eq(schema.articles.workspaceId, workspaceId), eq(schema.articles.brandId, brandId)));
  const [brand] = await db.select({ logo: schema.brands.logoKey, presenter: schema.brands.presenter }).from(schema.brands).where(and(eq(schema.brands.workspaceId, workspaceId), eq(schema.brands.id, brandId)));
  const keys = [...assets.map((a) => a.key), ...covers.map((c) => c.key ?? ""), brand?.logo ?? "", brand?.presenter?.faceKey ?? ""];
  // Only this workspace's own files (keys start with ws<id>/), never anything else in the bucket.
  return [...new Set(keys.filter((k) => k.startsWith(`ws${workspaceId}/`)))];
}

/** Delete the business and its files. Returns what was removed. */
export async function deleteBrandForever(workspaceId: number, brandId: number): Promise<{ files: number }> {
  const db = await getDb();
  const keys = await brandFileKeys(workspaceId, brandId);
  const removed = await db.transaction(async (tx) => {
    // The AI usage log stays (it counts toward the monthly free limits) but loses the business's text.
    await tx.update(schema.generations).set({ prompt: "", output: null, error: null }).where(and(eq(schema.generations.workspaceId, workspaceId), eq(schema.generations.brandId, brandId)));
    // Jobs are not linked by a foreign key: drop the business's queued work too.
    await tx.delete(schema.jobs).where(and(eq(schema.jobs.workspaceId, workspaceId), sql`${schema.jobs.payload}->>'brandId' = ${String(brandId)}`));
    return tx.delete(schema.brands).where(and(eq(schema.brands.workspaceId, workspaceId), eq(schema.brands.id, brandId))).returning({ id: schema.brands.id });
  });
  if (!removed.length) return { files: 0 };
  // Files after the database: if storage fails, nothing points at the files any more anyway.
  const files = await deleteFiles(keys).catch(() => 0);
  return { files };
}

export function formatBytes(b: number): string {
  if (b <= 0) return "0 KB";
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}
