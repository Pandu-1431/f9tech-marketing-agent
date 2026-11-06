import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { DEFAULT_TIMEZONE, isValidTimeZone, utcToZoned } from "./schedule";

/*
 * Post tracker (Layer 5): one row per post across every campaign, with where it went and how
 * it did. The same rows feed the Tracker page, the CSV download and the Google Sheet sync.
 * Always filtered by workspace.
 */

export type TrackerRow = {
  postId: number;
  date: string;
  time: string;
  brand: string;
  campaign: string;
  platform: string;
  format: string;
  status: string;
  headline: string;
  caption: string;
  link: string;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  views: number;
  score: number;
};

export const TRACKER_COLUMNS: { key: keyof TrackerRow; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "time", label: "Time" },
  { key: "brand", label: "Business" },
  { key: "campaign", label: "Campaign" },
  { key: "platform", label: "Platform" },
  { key: "format", label: "Format" },
  { key: "status", label: "Status" },
  { key: "headline", label: "Headline" },
  { key: "caption", label: "Caption" },
  { key: "link", label: "Link" },
  { key: "reach", label: "Reach" },
  { key: "likes", label: "Likes" },
  { key: "comments", label: "Comments" },
  { key: "shares", label: "Shares" },
  { key: "saves", label: "Saves" },
  { key: "views", label: "Views" },
  { key: "score", label: "Score" },
];

export type TrackerFilter = { brandId?: number; from?: string; to?: string; status?: string };

export async function trackerRows(workspaceId: number, f: TrackerFilter = {}): Promise<TrackerRow[]> {
  const db = await getDb();
  const where = [eq(schema.posts.workspaceId, workspaceId)];
  if (f.brandId) where.push(eq(schema.posts.brandId, f.brandId));
  if (f.from) where.push(gte(schema.posts.publishOn, f.from));
  if (f.to) where.push(lte(schema.posts.publishOn, f.to));
  if (f.status) where.push(eq(schema.posts.status, f.status));
  const rows = await db
    .select({ post: schema.posts, brand: schema.brands.name, campaign: schema.campaigns.theme })
    .from(schema.posts)
    .innerJoin(schema.brands, eq(schema.brands.id, schema.posts.brandId))
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.posts.campaignId))
    .where(and(...where))
    .orderBy(asc(schema.posts.publishOn), asc(schema.posts.scheduledAt), asc(schema.posts.id))
    .limit(2000);
  if (!rows.length) return [];

  const ids = rows.map((r) => r.post.id);
  const [pubs, metrics] = await Promise.all([
    db
      .select({ postId: schema.publications.postId, url: schema.publications.url, status: schema.publications.status })
      .from(schema.publications)
      .where(and(eq(schema.publications.workspaceId, workspaceId), inArray(schema.publications.postId, ids)))
      .orderBy(desc(schema.publications.id)),
    db.select().from(schema.postMetrics).where(and(eq(schema.postMetrics.workspaceId, workspaceId), inArray(schema.postMetrics.postId, ids))),
  ]);
  const link = new Map<number, string>();
  for (const p of pubs) if (p.url && !link.has(p.postId)) link.set(p.postId, p.url);
  const sum = new Map<number, Omit<TrackerRow, "postId" | "date" | "time" | "brand" | "campaign" | "platform" | "format" | "status" | "headline" | "caption" | "link">>();
  for (const m of metrics) {
    const s = sum.get(m.postId) ?? { reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, views: 0, score: 0 };
    s.reach += m.reach;
    s.likes += m.likes;
    s.comments += m.comments;
    s.shares += m.shares;
    s.saves += m.saves;
    s.views += m.views;
    s.score = Math.max(s.score, Math.round(Number(m.score)));
    sum.set(m.postId, s);
  }

  return rows.map(({ post, brand, campaign }) => {
    const tz = isValidTimeZone(post.timezone) ? post.timezone : DEFAULT_TIMEZONE;
    const time = post.scheduledAt ? utcToZoned(post.scheduledAt, tz).time : "";
    return {
      postId: post.id,
      date: post.publishOn,
      time,
      brand,
      campaign,
      platform: post.platform,
      format: post.format,
      status: post.status,
      headline: post.posterHeadline ?? "",
      caption: (post.caption ?? "").replace(/\s+/g, " ").trim(),
      link: link.get(post.id) ?? "",
      ...(sum.get(post.id) ?? { reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, views: 0, score: 0 }),
    };
  });
}

/** Header + rows as plain values (for CSV and Google Sheets). */
export function trackerTable(rows: TrackerRow[]): (string | number)[][] {
  return [TRACKER_COLUMNS.map((c) => c.label), ...rows.map((r) => TRACKER_COLUMNS.map((c) => r[c.key]))];
}

const csvCell = (v: string | number) => {
  const s = String(v);
  // Quote when needed; neutralise spreadsheet formulas (=, +, -, @) in text cells.
  const safe = typeof v === "string" && /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(table: (string | number)[][]): string {
  return table.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
