import { and, asc, count, eq, gt, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Brand } from "@/db/schema";
import { CHANNEL_PLATFORMS } from "@/agent/publish";

/*
 * "Go live" checklist: the shortest path from a new business to real posts on a real channel.
 *   1 business  2 a publishing channel  3 a goal (the Director)  4 approval (auto or by hand)  5 first post out
 */
export type GoLive = {
  channel: string | null;
  goal: boolean;
  approval: "auto" | "manual" | null;
  waiting: number;
  nextPostAt: Date | null;
  published: number;
  done: number;
};

export async function goLiveStatus(workspaceId: number, brand: Brand): Promise<GoLive> {
  const db = await getDb();
  const [[channel], [approved], [waiting], [next], [published]] = await Promise.all([
    db.select({ name: schema.channels.name, platform: schema.channels.platform }).from(schema.channels).where(and(eq(schema.channels.workspaceId, workspaceId), eq(schema.channels.brandId, brand.id), inArray(schema.channels.platform, [...CHANNEL_PLATFORMS]))).limit(1),
    db.select({ n: count() }).from(schema.posts).where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.brandId, brand.id), inArray(schema.posts.status, ["approved", "published"]))),
    db.select({ n: count() }).from(schema.posts).where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.brandId, brand.id), eq(schema.posts.status, "drafted"))),
    db.select({ at: schema.posts.scheduledAt }).from(schema.posts).where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.brandId, brand.id), eq(schema.posts.status, "approved"), gt(schema.posts.scheduledAt, new Date(Date.now() - 3 * 86400000)))).orderBy(asc(schema.posts.scheduledAt)).limit(1),
    db.select({ n: count() }).from(schema.publications).innerJoin(schema.posts, eq(schema.posts.id, schema.publications.postId)).where(and(eq(schema.publications.workspaceId, workspaceId), eq(schema.posts.brandId, brand.id), eq(schema.publications.status, "sent"))),
  ]);
  const approval = brand.autoApprove ? "auto" : Number(approved?.n ?? 0) > 0 ? "manual" : null;
  const s: GoLive = {
    channel: channel ? `${channel.name}` : null,
    goal: Boolean(brand.marketingGoal),
    approval,
    waiting: Number(waiting?.n ?? 0),
    nextPostAt: next?.at ?? null,
    published: Number(published?.n ?? 0),
    done: 0,
  };
  s.done = 1 + (s.channel ? 1 : 0) + (s.goal ? 1 : 0) + (s.approval ? 1 : 0) + (s.published > 0 ? 1 : 0);
  return s;
}
