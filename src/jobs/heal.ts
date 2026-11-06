import { and, eq, inArray, lt, ne, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

/*
 * Self-healing: once a minute the worker looks for posts that say "Writing…", "Designing…"
 * or "Making video…" (or are missing a poster / reel) but have no job working on them.
 * That happens when a job gave up while a free AI was out of its limit, or the app was
 * restarted mid-job. It queues the missing work again, a few items at a time, so the
 * campaign always finishes by itself once the free limits come back.
 */

const STUCK_MS = 4 * 60_000; // "in progress" with no job for this long = stuck
const RETRY_FAILED_MS = 20 * 60_000; // failed posters / videos are tried again after this
const MAX_PER_TICK = 6;

export async function healStuckWork(now = Date.now()): Promise<number> {
  const db = await getDb();
  const stuckBefore = new Date(now - STUCK_MS);
  const failedBefore = new Date(now - RETRY_FAILED_MS);

  // Work already queued or running, so we never queue the same thing twice.
  const open = await db
    .select({ type: schema.jobs.type, payload: schema.jobs.payload })
    .from(schema.jobs)
    .where(inArray(schema.jobs.status, ["queued", "running"]));
  const busyCampaign = new Set(open.filter((j) => j.type.startsWith("campaign.")).map((j) => Number(j.payload.campaignId)));
  const busyPost = new Set(open.filter((j) => j.type.startsWith("post.")).map((j) => `${j.type}:${Number(j.payload.postId)}`));

  const candidates = await db
    .select()
    .from(schema.posts)
    .where(
      and(
        ne(schema.posts.status, "published"),
        ne(schema.posts.status, "rejected"),
        or(
          and(eq(schema.posts.status, "idea"), lt(schema.posts.updatedAt, stuckBefore)),
          and(eq(schema.posts.designStatus, "designing"), lt(schema.posts.updatedAt, stuckBefore)),
          and(eq(schema.posts.reelStatus, "making"), lt(schema.posts.updatedAt, stuckBefore)),
          and(ne(schema.posts.status, "idea"), inArray(schema.posts.designStatus, ["failed", "none"]), lt(schema.posts.updatedAt, failedBefore)),
          and(eq(schema.posts.format, "reel"), eq(schema.posts.designStatus, "done"), inArray(schema.posts.reelStatus, ["none", "failed"]), lt(schema.posts.updatedAt, failedBefore)),
        ),
      ),
    )
    .orderBy(schema.posts.updatedAt)
    .limit(40);

  const { enqueue } = await import("./queue");
  let queued = 0;
  const touch = (id: number, set: Partial<typeof schema.posts.$inferInsert>) =>
    db.update(schema.posts).set({ ...set, updatedAt: new Date() }).where(eq(schema.posts.id, id));

  for (const p of candidates) {
    if (queued >= MAX_PER_TICK) break;
    if (p.status === "idea") {
      if (busyCampaign.has(p.campaignId)) continue; // the campaign's own job will handle it
      // Ideas are written by the campaign's write job (it writes every idea that is left).
      await db.update(schema.campaigns).set({ status: "writing", error: null }).where(eq(schema.campaigns.id, p.campaignId));
      await touch(p.id, {});
      await enqueue("campaign.write", { workspaceId: p.workspaceId, campaignId: p.campaignId }, p.workspaceId);
      busyCampaign.add(p.campaignId);
      queued++;
      continue;
    }
    const needsPoster = p.designStatus === "designing" || p.designStatus === "failed" || p.designStatus === "none";
    if (needsPoster) {
      if (busyCampaign.has(p.campaignId)) continue;
      if (busyPost.has(`post.design:${p.id}`) || busyPost.has(`post.rewrite:${p.id}`)) continue;
      await touch(p.id, { designStatus: "designing", lastError: null });
      await enqueue("post.design", { workspaceId: p.workspaceId, postId: p.id }, p.workspaceId);
      busyPost.add(`post.design:${p.id}`);
      queued++;
      continue;
    }
    if (p.format === "reel" || p.reelStatus === "making") {
      if (busyPost.has(`post.reel:${p.id}`)) continue;
      await touch(p.id, { reelStatus: "making", reelError: null });
      await enqueue("post.reel", { workspaceId: p.workspaceId, postId: p.id }, p.workspaceId);
      busyPost.add(`post.reel:${p.id}`);
      queued++;
    }
  }
  if (queued) console.log(`[agent worker] self-healing: queued ${queued} missing job(s)`);
  return queued;
}

/** Queued or running jobs for a campaign or its posts (0 while posts say "in progress" = stuck). */
export async function openJobCount(workspaceId: number, campaignId: number): Promise<number> {
  const db = await getDb();
  const open = await db.execute(sql`
    SELECT count(*)::int AS n FROM ${schema.jobs}
    WHERE workspace_id = ${workspaceId} AND status IN ('queued','running')
      AND (payload->>'campaignId' = ${String(campaignId)}
        OR payload->>'postId' IN (SELECT id::text FROM ${schema.posts} WHERE campaign_id = ${campaignId}))
  `);
  const rows = (open as unknown as { rows: { n: number }[] }).rows;
  return Number(rows?.[0]?.n ?? 0);
}
