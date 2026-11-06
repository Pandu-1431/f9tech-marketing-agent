import type { Brand, Campaign, Post } from "@/db/schema";
import { checkPost, HYPE_WORDS } from "../quality";
import { CAPTION_RULES, HASHTAG_RULES } from "@/lib/formats";
import { hookType } from "../analyst/score";

/*
 * Agent scorecard: measures whether the AI team produced GOOD marketing, not just output.
 * Pure functions, no AI call. Used by `npm run eval` (scripts/eval-agents.ts) and by tests,
 * so a prompt or provider change can be judged with numbers before it ships.
 *
 * Every number is 0-100 (higher is better). The overall score is a weighted mix.
 */

export type PostForEval = Pick<
  Post,
  "id" | "platform" | "format" | "publishOn" | "angle" | "caption" | "hashtags" | "posterHeadline" | "posterSubline" | "posterKicker" | "posterCta" | "posterTemplate" | "designStatus" | "demoParts" | "status" | "seoKeywords"
>;

export type Scorecard = {
  posts: number;
  /** % of posts with no QC "fail" issue. */
  safe: number;
  /** % of posts with no QC issue at all. */
  clean: number;
  /** % of sentences at or under 12 words (simple-language rule). */
  readable: number;
  /** % of posts with no hype word. */
  plain: number;
  /** % unique hooks (first lines) + headlines + templates across the campaign. */
  variety: number;
  /** % of posts that carry a brand hashtag, a CTA, and at least one brand keyword or service word. */
  onBrand: number;
  /** % of posts within platform caption/hashtag limits. */
  fits: number;
  /** % of posts whose poster got made (when posters were asked for). */
  finished: number;
  overall: number;
  issues: Record<string, number>;
  hooks: Record<string, number>;
};

const pct = (num: number, den: number) => (den ? Math.round((num / den) * 100) : 100);
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const firstLine = (s: string | null | undefined) => (s ?? "").split("\n").map((l) => l.trim()).find(Boolean)?.toLowerCase() ?? "";

/** Sentences of a caption (emoji and hashtags removed). */
export function sentences(text: string): string[] {
  return text
    .replace(/#\w+/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .split(/[.!?।]\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => words(s).length >= 2);
}

export function readability(text: string): { sentences: number; short: number } {
  const ss = sentences(text);
  return { sentences: ss.length, short: ss.filter((s) => words(s).length <= 12).length };
}

export function hasHype(text: string): boolean {
  const t = text.toLowerCase();
  return HYPE_WORDS.some((w) => t.includes(w));
}

export function fitsPlatform(post: Pick<PostForEval, "platform" | "caption" | "hashtags">): boolean {
  const cap = CAPTION_RULES[post.platform];
  const tags = HASHTAG_RULES[post.platform];
  const len = (post.caption ?? "").length;
  if (cap && len > cap.limit) return false;
  if (tags && post.hashtags.length > tags.max) return false;
  return true;
}

export function onBrandCheck(post: PostForEval, brand: Pick<Brand, "hashtags" | "keywords" | "services" | "name">, campaign: Pick<Campaign, "callToAction" | "hashtags">): { tag: boolean; cta: boolean; keyword: boolean } {
  const text = `${post.caption ?? ""}\n${post.posterHeadline ?? ""}\n${post.posterSubline ?? ""}`.toLowerCase();
  const tagsWanted = [...brand.hashtags, ...campaign.hashtags].map((h) => h.toLowerCase());
  const tag = tagsWanted.length === 0 || post.hashtags.some((h) => tagsWanted.includes(h.toLowerCase()));
  const cta = Boolean(post.posterCta) || /\b(download|install|join|visit|book|call|order|start|try|open|register|sign up|apply|learn more|link in bio|whatsapp)\b/i.test(text);
  const vocab = [...brand.keywords, ...(brand.services ?? "").split(/\r?\n/), brand.name]
    .map((k) => k.replace(/^[-*•\s]+/, "").trim().toLowerCase())
    .filter((k) => k.length >= 3);
  const keyword = vocab.length === 0 || vocab.some((k) => text.includes(k));
  return { tag, cta, keyword };
}

export function scorecard(posts: PostForEval[], brand: Brand, campaign: Campaign, opts: { posters?: boolean } = {}): Scorecard {
  const n = posts.length;
  const siblings = posts.map((p) => ({ id: p.id, posterHeadline: p.posterHeadline }));
  const issues: Record<string, number> = {};
  const hooks: Record<string, number> = {};
  let safe = 0;
  let clean = 0;
  let sentencesTotal = 0;
  let sentencesShort = 0;
  let plain = 0;
  let onBrand = 0;
  let fits = 0;
  let finished = 0;

  for (const p of posts) {
    const found = checkPost({ post: p, brand, campaign, siblings });
    for (const i of found) issues[i.code] = (issues[i.code] ?? 0) + 1;
    if (!found.some((i) => i.level === "fail")) safe++;
    if (found.length === 0) clean++;
    const text = `${p.caption ?? ""}\n${p.posterSubline ?? ""}`;
    const r = readability(text);
    sentencesTotal += r.sentences;
    sentencesShort += r.short;
    if (!hasHype(`${text}\n${p.posterHeadline ?? ""}`)) plain++;
    const b = onBrandCheck(p, brand, campaign);
    if (b.tag && b.cta && b.keyword) onBrand++;
    if (fitsPlatform(p)) fits++;
    if (p.format === "text" || p.designStatus === "done") finished++;
    const h = hookType(p.caption);
    hooks[h] = (hooks[h] ?? 0) + 1;
  }

  const uniq = (xs: string[]) => new Set(xs.filter(Boolean)).size;
  const varietyParts = [
    pct(uniq(posts.map((p) => firstLine(p.caption))), n),
    pct(uniq(posts.map((p) => (p.posterHeadline ?? "").toLowerCase())), n),
    n >= 4 ? Math.min(100, pct(uniq(posts.map((p) => p.posterTemplate)), Math.min(n, 4))) : 100,
  ];
  const variety = Math.round(varietyParts.reduce((a, b) => a + b, 0) / varietyParts.length);

  const card: Omit<Scorecard, "overall"> = {
    posts: n,
    safe: pct(safe, n),
    clean: pct(clean, n),
    readable: pct(sentencesShort, sentencesTotal),
    plain: pct(plain, n),
    variety,
    onBrand: pct(onBrand, n),
    fits: pct(fits, n),
    finished: opts.posters === false ? 100 : pct(finished, n),
    issues,
    hooks,
  };
  const overall = Math.round(0.25 * card.safe + 0.1 * card.clean + 0.15 * card.readable + 0.1 * card.plain + 0.15 * card.variety + 0.15 * card.onBrand + 0.05 * card.fits + 0.05 * card.finished);
  return { ...card, overall };
}

/** A short table for the terminal. */
export function formatScorecard(card: Scorecard, previous?: Scorecard | null): string {
  const rows: [string, keyof Scorecard][] = [
    ["Overall", "overall"],
    ["Safe to publish (no QC fail)", "safe"],
    ["Clean (no QC issue)", "clean"],
    ["Readable (sentences ≤ 12 words)", "readable"],
    ["Plain (no hype words)", "plain"],
    ["Variety (hooks, headlines, layouts)", "variety"],
    ["On brand (tag + CTA + keyword)", "onBrand"],
    ["Fits platform limits", "fits"],
    ["Finished (poster made)", "finished"],
  ];
  const lines = rows.map(([label, key]) => {
    const v = card[key] as number;
    const prev = previous ? (previous[key] as number) : null;
    const delta = prev === null ? "" : v - prev === 0 ? "   (same)" : `   (${v - prev > 0 ? "+" : ""}${v - prev})`;
    return `${label.padEnd(36)} ${String(v).padStart(3)}${delta}`;
  });
  const issueLines = Object.entries(card.issues)
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => `  ${code}: ${n}`);
  return [`Posts: ${card.posts}`, ...lines, issueLines.length ? "QC issues:" : "QC issues: none", ...issueLines, `Hooks: ${JSON.stringify(card.hooks)}`].join("\n");
}
