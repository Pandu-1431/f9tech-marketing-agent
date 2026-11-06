/*
 * The Analyst's maths. Pure functions (no database, no network), so they are easy to test
 * and the learning rules are easy to read and change.
 *
 * One post result -> one score. Many results -> plain-English learnings the other agents
 * follow ("Reels get 2.4x the engagement of image posts on Instagram (8 posts)").
 */

export type Metrics = {
  impressions?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  views?: number;
  clicks?: number;
};

/** What a learning needs to know about a post (the Analyst joins posts, versions and metrics). */
export type ScoredPost = {
  postId: number;
  platform: string;
  format: string;
  template?: string | null;
  /** Local posting time "HH:MM" (the brand's zone). */
  time?: string | null;
  caption?: string | null;
  angle?: string | null;
  headline?: string | null;
  score: number;
  metrics: Metrics;
};

export type Learning = {
  topic: "format" | "platform" | "time" | "template" | "hook" | "length" | "example";
  text: string;
  data: Record<string, unknown>;
  /** How many posts the learning stands on (prompt order and trust). */
  weight: number;
};

const n = (v: number | undefined) => (Number.isFinite(v) ? Math.max(0, Number(v)) : 0);

/**
 * Engagement score. A comment is worth two likes, a share or a save is worth three
 * (they spread the post / show intent). Views count a little (a reel with 1,000 views
 * and no likes still did something). Reach does not add to the score by itself, so a
 * post that reached many people but moved nobody scores low.
 */
export function engagementScore(m: Metrics): number {
  const s = n(m.likes) + 2 * n(m.comments) + 3 * n(m.shares) + 3 * n(m.saves) + 2 * n(m.clicks) + n(m.views) / 100;
  return Math.round(s * 1000) / 1000;
}

/** Engagement per 100 people reached, when reach is known (fair across small and big posts). */
export function engagementRate(m: Metrics): number | null {
  const reach = n(m.reach) || n(m.impressions);
  if (!reach) return null;
  return Math.round(((engagementScore(m) - n(m.views) / 100) / reach) * 100 * 100) / 100;
}

export const MIN_POSTS_PER_GROUP = 3; // never draw a conclusion from fewer posts
export const MIN_LIFT = 1.3; // a group must beat the rest by 30% to be called "better"

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round1 = (x: number) => Math.round(x * 10) / 10;
const hourBucket = (time: string | null | undefined): string | null => {
  const m = time?.match(/^(\d{2}):/);
  if (!m) return null;
  const h = Number(m[1]);
  if (h < 11) return "morning";
  if (h < 16) return "afternoon";
  if (h < 20) return "evening";
  return "night";
};
const BUCKET_TIME: Record<string, string> = { morning: "09:00", afternoon: "13:00", evening: "19:00", night: "21:00" };

/** Hook = how the caption starts. */
export function hookType(caption: string | null | undefined): string {
  const first = (caption ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (!first) return "none";
  if (/\?$/.test(first) || /^(why|how|what|did you|do you|are you|can you|kya|kaise)\b/i.test(first)) return "question";
  if (/^\d|\b\d+\b/.test(first)) return "number";
  if (/^[\p{Extended_Pictographic}]/u.test(first)) return "emoji";
  if (/^(you|your|aap|tum)\b/i.test(first)) return "you";
  return "statement";
}

export function lengthBucket(caption: string | null | undefined): string {
  const words = (caption ?? "").trim().split(/\s+/).filter(Boolean).length;
  if (words <= 40) return "short";
  if (words <= 90) return "medium";
  return "long";
}

/**
 * Compare groups of posts: the best group must have MIN_POSTS_PER_GROUP posts and beat the
 * average of the others by MIN_LIFT. Returns the winner, or null when nothing stands out.
 */
export function bestGroup<T extends { score: number }>(items: T[], key: (t: T) => string | null): { group: string; lift: number; count: number; avg: number } | null {
  const groups = new Map<string, number[]>();
  for (const it of items) {
    const k = key(it);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), it.score]);
  }
  if (groups.size < 2) return null;
  let best: { group: string; lift: number; count: number; avg: number } | null = null;
  for (const [group, scores] of groups) {
    if (scores.length < MIN_POSTS_PER_GROUP) continue;
    const others = [...groups].filter(([g]) => g !== group).flatMap(([, s]) => s);
    if (others.length < MIN_POSTS_PER_GROUP) continue;
    const mine = avg(scores);
    const rest = avg(others);
    const lift = rest > 0 ? mine / rest : mine > 0 ? MIN_LIFT : 0;
    if (lift >= MIN_LIFT && (!best || lift > best.lift)) best = { group, lift: round1(lift), count: scores.length, avg: round1(mine) };
  }
  return best;
}

const label: Record<string, string> = { image: "image posts", carousel: "carousels", reel: "reels", story: "stories", text: "text posts" };
const fmt = (f: string) => label[f] ?? f;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Results -> learnings. Empty when there is not enough data yet (the agents then use the Brand Kit only). */
export function deriveLearnings(posts: ScoredPost[]): Learning[] {
  const out: Learning[] = [];
  const scored = posts.filter((p) => p.score > 0 || Object.values(p.metrics).some((v) => n(v) > 0));
  if (scored.length < MIN_POSTS_PER_GROUP * 2) return out;

  const platforms = [...new Set(scored.map((p) => p.platform))];

  // Which platform works best overall.
  const bp = bestGroup(scored, (p) => p.platform);
  if (bp) out.push({ topic: "platform", text: `${cap(bp.group)} gets ${bp.lift}x the engagement of the other platforms (${bp.count} posts). Give it the strongest ideas.`, data: { platform: bp.group, lift: bp.lift }, weight: bp.count });

  for (const platform of platforms) {
    const mine = scored.filter((p) => p.platform === platform);
    const bf = bestGroup(mine, (p) => p.format);
    if (bf) out.push({ topic: "format", text: `On ${platform}, ${fmt(bf.group)} get ${bf.lift}x the engagement of other formats (${bf.count} posts). Plan more of them.`, data: { platform, format: bf.group, lift: bf.lift }, weight: bf.count });

    const bt = bestGroup(mine, (p) => hourBucket(p.time));
    if (bt) out.push({ topic: "time", text: `On ${platform}, posts in the ${bt.group} get ${bt.lift}x the engagement (${bt.count} posts). Post around ${BUCKET_TIME[bt.group]}.`, data: { platform, bucket: bt.group, time: BUCKET_TIME[bt.group], lift: bt.lift }, weight: bt.count });
  }

  const btpl = bestGroup(scored.filter((p) => p.template), (p) => p.template ?? null);
  if (btpl) out.push({ topic: "template", text: `The "${btpl.group}" poster layout gets ${btpl.lift}x the engagement of the others (${btpl.count} posts). Use it more, but keep variety.`, data: { template: btpl.group, lift: btpl.lift }, weight: btpl.count });

  const bh = bestGroup(scored, (p) => hookType(p.caption));
  if (bh && bh.group !== "none") {
    const how: Record<string, string> = { question: "a question", number: "a number", emoji: "an emoji", you: "the word \"you\"", statement: "a plain statement" };
    out.push({ topic: "hook", text: `Captions that open with ${how[bh.group] ?? bh.group} get ${bh.lift}x the engagement (${bh.count} posts). Open most captions that way.`, data: { hook: bh.group, lift: bh.lift }, weight: bh.count });
  }

  const bl = bestGroup(scored, (p) => lengthBucket(p.caption));
  if (bl) {
    const words: Record<string, string> = { short: "under 40 words", medium: "40-90 words", long: "over 90 words" };
    out.push({ topic: "length", text: `${cap(bl.group)} captions (${words[bl.group]}) get ${bl.lift}x the engagement (${bl.count} posts). Keep captions ${bl.group}.`, data: { length: bl.group, lift: bl.lift }, weight: bl.count });
  }

  // The best posts themselves, as examples the copywriter can learn the style from.
  const top = [...scored].sort((a, b) => b.score - a.score).slice(0, 3).filter((p) => p.score > 0 && (p.angle || p.headline));
  for (const p of top) {
    const what = [p.headline && `poster "${p.headline}"`, p.angle && `idea: ${p.angle}`].filter(Boolean).join("; ");
    out.push({ topic: "example", text: `A top post (${p.platform}, ${fmt(p.format)}, score ${Math.round(p.score)}): ${what}`.slice(0, 300), data: { postId: p.postId, score: p.score }, weight: 1 });
  }
  return out;
}
