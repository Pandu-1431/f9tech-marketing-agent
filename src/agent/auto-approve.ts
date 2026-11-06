import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { BusyPostError, DemoContentError, reviewPost, StaleVersionError } from "@/lib/data";

/*
 * Auto-approve (per business, off by default): a finished post whose quality check passed, or only
 * found small tips, is approved by the agent and then goes out at its scheduled time. A post the
 * checker failed, demo content, or a post whose poster or video is still being made keeps waiting
 * for a person. Approvals are logged with no user (= the agent), so the history shows it.
 */
export async function autoApproveReady(): Promise<number> {
  const db = await getDb();
  const ready = await db
    .select({ id: schema.posts.id, workspaceId: schema.posts.workspaceId, version: schema.posts.currentVersion })
    .from(schema.posts)
    .innerJoin(schema.brands, eq(schema.brands.id, schema.posts.brandId))
    .where(
      and(
        eq(schema.brands.autoApprove, true),
        eq(schema.posts.status, "drafted"),
        inArray(schema.posts.qcStatus, ["pass", "warn"]),
        gt(schema.posts.currentVersion, 0),
        sql`jsonb_array_length(${schema.posts.demoParts}) = 0`,
        sql`(${schema.posts.format} = 'text' or ${schema.posts.designStatus} = 'done')`,
        sql`${schema.posts.reelStatus} <> 'making'`,
        // A post a person once rejected always comes back to a person.
        sql`not exists (select 1 from ${schema.approvals} a where a.post_id = ${schema.posts.id} and a.decision = 'rejected')`,
      ),
    )
    .limit(100);
  let n = 0;
  for (const p of ready) {
    try {
      await reviewPost(p.workspaceId, p.id, "approved", null, { userId: null, version: p.version });
      n++;
    } catch (err) {
      if (!(err instanceof DemoContentError || err instanceof StaleVersionError || err instanceof BusyPostError)) throw err;
    }
  }
  return n;
}
