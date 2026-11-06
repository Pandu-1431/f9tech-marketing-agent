import { readJson, type ChannelAuth } from "../publish/types";
import { accessToken } from "../publish/youtube";
import type { Metrics } from "./score";

/*
 * Reads the results of ONE published post back from its platform.
 * Same tokens and base URLs as the publishers (META_GRAPH_URL, YOUTUBE_API_URL can point
 * to a stub in tests). Every platform returns the same Metrics shape; a number the platform
 * does not give (or refuses: missing permission, unaudited app) is simply left out.
 *
 *   facebook  : likes, comments, shares + insights (impressions, reach, clicks) when the
 *               Page token has read_insights.
 *   instagram : like_count, comments_count + insights (reach, saved, shares, views).
 *   youtube   : videos.list statistics (views, likes, comments).
 *   telegram  : the Bot API gives no view counts for channel posts -> null (not measured).
 */

const GRAPH = () => (process.env.META_GRAPH_URL ?? "https://graph.facebook.com").replace(/\/$/, "");
const VERSION = () => process.env.META_GRAPH_VERSION ?? "v23.0";
const YT = () => (process.env.YOUTUBE_API_URL ?? "https://www.googleapis.com").replace(/\/$/, "");

const num = (v: unknown): number | undefined => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) ? x : undefined;
};

async function graphGet(path: string, token: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const u = new URL(`${GRAPH()}/${VERSION()}/${path.replace(/^\//, "")}`);
  u.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u);
  const json = await readJson(res);
  const err = json.error as { message?: string } | undefined;
  if (!res.ok || err) throw new Error(`Meta ${path}: ${err?.message ?? res.status}`);
  return json;
}

/** { metric_name: value } from a Graph insights answer. */
function insightsMap(json: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of (json.data as { name?: string; values?: { value?: unknown }[]; total_value?: { value?: unknown } }[] | undefined) ?? []) {
    const v = num(item.total_value?.value) ?? num(item.values?.[0]?.value);
    if (item.name && v !== undefined) out[item.name] = v;
  }
  return out;
}

export async function facebookMetrics(auth: ChannelAuth, externalId: string): Promise<Metrics> {
  const base = await graphGet(externalId, auth.token, { fields: "likes.summary(true),comments.summary(true),shares" });
  const m: Metrics = {
    likes: num((base.likes as { summary?: { total_count?: unknown } })?.summary?.total_count),
    comments: num((base.comments as { summary?: { total_count?: unknown } })?.summary?.total_count),
    shares: num((base.shares as { count?: unknown })?.count),
  };
  try {
    const ins = insightsMap(await graphGet(`${externalId}/insights`, auth.token, { metric: "post_impressions,post_impressions_unique,post_clicks" }));
    m.impressions = ins.post_impressions;
    m.reach = ins.post_impressions_unique;
    m.clicks = ins.post_clicks;
  } catch {
    /* no read_insights permission yet: likes/comments/shares are still useful */
  }
  return m;
}

export async function instagramMetrics(auth: ChannelAuth, externalId: string): Promise<Metrics> {
  const base = await graphGet(externalId, auth.token, { fields: "like_count,comments_count,media_type,media_product_type" });
  const m: Metrics = { likes: num(base.like_count), comments: num(base.comments_count) };
  // Newer Graph versions use "views"; older ones "impressions"/"plays". Ask for the modern set, then the old set.
  for (const metric of ["reach,saved,shares,views", "reach,saved,impressions"]) {
    try {
      const ins = insightsMap(await graphGet(`${externalId}/insights`, auth.token, { metric }));
      m.reach = ins.reach ?? m.reach;
      m.saves = ins.saved ?? m.saves;
      m.shares = ins.shares ?? m.shares;
      m.views = ins.views ?? ins.plays ?? m.views;
      m.impressions = ins.impressions ?? m.impressions;
      break;
    } catch {
      /* try the next metric set */
    }
  }
  return m;
}

export async function youtubeMetrics(auth: ChannelAuth, externalId: string): Promise<Metrics> {
  const token = await accessToken(auth.token);
  const res = await fetch(`${YT()}/youtube/v3/videos?part=statistics&id=${encodeURIComponent(externalId)}`, { headers: { authorization: `Bearer ${token}` } });
  const json = await readJson(res);
  const stats = (json.items as { statistics?: Record<string, unknown> }[] | undefined)?.[0]?.statistics;
  if (!res.ok || !stats) throw new Error(`YouTube videos.list: ${String((json.error as { message?: string })?.message ?? res.status)}`);
  return { views: num(stats.viewCount), likes: num(stats.likeCount), comments: num(stats.commentCount) };
}

export type MetricsReader = (auth: ChannelAuth, externalId: string) => Promise<Metrics>;

export const READERS: Record<string, MetricsReader | null> = {
  facebook: facebookMetrics,
  instagram: instagramMetrics,
  youtube: youtubeMetrics,
  telegram: null, // not measurable through the Bot API
};

/** Reads the metrics for a platform; null when that platform cannot be measured. */
export async function readMetrics(platform: string, auth: ChannelAuth, externalId: string): Promise<Metrics | null> {
  const reader = READERS[platform];
  return reader ? reader(auth, externalId) : null;
}
