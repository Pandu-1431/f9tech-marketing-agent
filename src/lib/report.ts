import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Asset, Brand } from "@/db/schema";

/*
 * Monthly report for one business: what was published, what it achieved, how that compares with
 * the month before, the best posts, and what happens next. Numbers only (no AI), so it is instant
 * and free. The page prints to a clean PDF.
 */

export type Totals = { published: number; reach: number; engagement: number; views: number; clicks: number; leads: number; won: number };
export type BestPost = { postId: number; platform: string; format: string; headline: string; caption: string; url: string | null; reach: number; engagement: number; views: number; poster: Asset | null };

export type MonthlyReport = {
  brand: Brand;
  month: string;
  from: Date;
  to: Date;
  totals: Totals;
  previous: Totals;
  byPlatform: { platform: string; published: number; reach: number; engagement: number }[];
  byFormat: { format: string; published: number; engagement: number }[];
  best: BestPost[];
  learnings: string[];
};

export function monthRange(month: string): { from: Date; to: Date } {
  const [y, m] = month.split("-").map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
}

export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export const isMonth = (v: string | undefined): v is string => Boolean(v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v));

/** Percent change, or null when there is nothing to compare with. */
export function change(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) / before) * 100);
}

async function totalsFor(workspaceId: number, brandId: number, from: Date, to: Date) {
  const db = await getDb();
  const pubs = await db
    .select({ pub: schema.publications, post: schema.posts })
    .from(schema.publications)
    .innerJoin(schema.posts, eq(schema.posts.id, schema.publications.postId))
    .where(and(eq(schema.publications.workspaceId, workspaceId), eq(schema.posts.brandId, brandId), eq(schema.publications.status, "sent"), gte(schema.publications.publishedAt, from), lt(schema.publications.publishedAt, to)));
  const pubIds = pubs.map((p) => p.pub.id);
  const metrics = pubIds.length ? await db.select().from(schema.postMetrics).where(and(eq(schema.postMetrics.workspaceId, workspaceId), inArray(schema.postMetrics.publicationId, pubIds))) : [];
  const byPub = new Map(metrics.map((m) => [m.publicationId, m]));
  const { clicksBetween } = await import("./links");
  const { leadsBetween } = await import("./leads");
  const leadsWon = await db
    .select({ id: schema.leads.id })
    .from(schema.leads)
    .where(and(eq(schema.leads.workspaceId, workspaceId), eq(schema.leads.brandId, brandId), eq(schema.leads.status, "won"), gte(schema.leads.createdAt, from), lt(schema.leads.createdAt, to)));
  const eng = (m?: (typeof metrics)[number]) => (m ? m.likes + m.comments + m.shares + m.saves : 0);
  const totals: Totals = {
    published: pubs.length,
    reach: pubs.reduce((a, p) => a + (byPub.get(p.pub.id)?.reach ?? 0), 0),
    engagement: pubs.reduce((a, p) => a + eng(byPub.get(p.pub.id)), 0),
    views: pubs.reduce((a, p) => a + (byPub.get(p.pub.id)?.views ?? 0), 0),
    clicks: await clicksBetween(workspaceId, brandId, from, to),
    leads: await leadsBetween(workspaceId, brandId, from, to),
    won: leadsWon.length,
  };
  return { totals, pubs, byPub, eng };
}

export async function monthlyReport(workspaceId: number, brand: Brand, month: string): Promise<MonthlyReport> {
  const { from, to } = monthRange(month);
  const prev = monthRange(previousMonth(month));
  const cur = await totalsFor(workspaceId, brand.id, from, to);
  const before = await totalsFor(workspaceId, brand.id, prev.from, prev.to);

  const platforms = new Map<string, { published: number; reach: number; engagement: number }>();
  const formats = new Map<string, { published: number; engagement: number }>();
  for (const { pub, post } of cur.pubs) {
    const m = cur.byPub.get(pub.id);
    const p = platforms.get(pub.platform) ?? { published: 0, reach: 0, engagement: 0 };
    p.published++;
    p.reach += m?.reach ?? 0;
    p.engagement += cur.eng(m);
    platforms.set(pub.platform, p);
    const f = formats.get(post.format) ?? { published: 0, engagement: 0 };
    f.published++;
    f.engagement += cur.eng(m);
    formats.set(post.format, f);
  }

  const ranked = [...cur.pubs]
    .map(({ pub, post }) => ({ pub, post, m: cur.byPub.get(pub.id) }))
    .sort((a, b) => cur.eng(b.m) * 3 + (b.m?.reach ?? 0) / 10 - (cur.eng(a.m) * 3 + (a.m?.reach ?? 0) / 10))
    .slice(0, 3);
  const db = await getDb();
  const posters = ranked.length
    ? await db
        .select()
        .from(schema.assets)
        .where(and(eq(schema.assets.workspaceId, workspaceId), inArray(schema.assets.postId, ranked.map((r) => r.post.id)), eq(schema.assets.kind, "poster")))
        .orderBy(desc(schema.assets.id))
    : [];
  const posterOf = (postId: number) => posters.find((a) => a.postId === postId) ?? null;

  const memory = await db
    .select({ text: schema.memory.text })
    .from(schema.memory)
    .where(and(eq(schema.memory.workspaceId, workspaceId), eq(schema.memory.brandId, brand.id), eq(schema.memory.active, true), inArray(schema.memory.source, ["analyst", "director"])))
    .orderBy(desc(schema.memory.weight))
    .limit(4);

  return {
    brand,
    month,
    from,
    to,
    totals: cur.totals,
    previous: before.totals,
    byPlatform: [...platforms.entries()].map(([platform, v]) => ({ platform, ...v })).sort((a, b) => b.engagement - a.engagement),
    byFormat: [...formats.entries()].map(([format, v]) => ({ format, ...v })).sort((a, b) => b.engagement - a.engagement),
    best: ranked.map(({ pub, post, m }) => ({
      postId: post.id,
      platform: pub.platform,
      format: post.format,
      headline: post.posterHeadline ?? "",
      caption: (post.caption ?? "").replace(/\s+/g, " ").slice(0, 160),
      url: pub.url,
      reach: m?.reach ?? 0,
      engagement: cur.eng(m),
      views: m?.views ?? 0,
      poster: posterOf(post.id),
    })),
    learnings: memory.map((m) => m.text),
  };
}

/** One plain-language line about the month (no AI). */
export function headline(r: Pick<MonthlyReport, "totals" | "previous">): string {
  const t = r.totals;
  if (!t.published) return "Nothing was published this month yet. Approve posts on the Review page so they go out on schedule.";
  const parts = [`${t.published} posts went out`];
  if (t.reach) parts.push(`reaching ${t.reach.toLocaleString("en-IN")} people`);
  if (t.engagement) parts.push(`with ${t.engagement.toLocaleString("en-IN")} likes, comments, shares and saves`);
  let s = `${parts.join(", ")}.`;
  if (t.clicks || t.leads) s += ` They brought ${t.clicks} link clicks and ${t.leads} new lead${t.leads === 1 ? "" : "s"}${t.won ? ` (${t.won} became customers)` : ""}.`;
  const ch = change(t.engagement, r.previous.engagement);
  if (ch !== null) s += ` Engagement is ${ch >= 0 ? "up" : "down"} ${Math.abs(ch)}% on last month.`;
  return s;
}
