import type { Brand, Campaign, Post } from "@/db/schema";
import { CAPTION_RULES, HASHTAG_RULES } from "@/lib/formats";

/*
 * Quality checker: the team member who checks every post before it reaches a human.
 * Pure rules, no AI call, so it is free and instant. It catches what breaks trust:
 * numbers the brand never gave us, risky promises, hype words, long sentences,
 * too many hashtags, a missing poster or logo, demo content.
 *
 * "fail" = must be fixed before publishing (the agent tries to fix it itself).
 * "warn" = a person should look; approval is still allowed.
 */

import type { QcIssue } from "@/db/schema";

export type { QcIssue };
export type QcLevel = QcIssue["level"];
// QcIssue.fix: how the agent can fix it: "rewrite" = ask the copywriter again, "hashtags" = trim them.
export type QcStatus = "none" | "pass" | "warn" | "fail";

export const HYPE_WORDS = [
  "revolutionary",
  "revolutionise",
  "revolutionize",
  "game-changer",
  "game changer",
  "unlock",
  "elevate",
  "unleash",
  "supercharge",
  "seamless",
  "cutting-edge",
  "next-level",
  "world-class",
  "delve",
  "skyrocket",
];

/** Promises nobody can keep (and that platforms and Indian ad rules frown on). */
export const RISKY_CLAIMS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bguarantee(d|s)?\b/i, label: "guaranteed" },
  { pattern: /\b100\s?%/i, label: "100%" },
  { pattern: /\bassured\s+(selection|success|results?|rank)\b/i, label: "assured results" },
  { pattern: /\bsure[\s-]?shot\b/i, label: "sure-shot" },
  { pattern: /\btop\s+rank(s|er)?\b/i, label: "top rank" },
  { pattern: /\b(no\.?\s?1|number\s?one|#1)\b/i, label: "number one" },
  { pattern: /\bbest\s+in\s+(india|the\s+world)\b/i, label: "best in India" },
  { pattern: /\bcrack\s+(upsc|the\s+exam|ias)\s+in\s+\d+/i, label: "crack the exam in N days" },
];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Numbers in a text, normalised ("₹1,50,000" -> "150000", "95%" -> "95", "2.5" -> "2.5"). */
export function numbersIn(text: string): string[] {
  const clean = text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/#\w+/g, " ") // hashtags like #UPSC2027 are tags, not claims
    .replace(/\b[\w.-]+\.(com|in|guru|org|net|app|io)\b\S*/gi, " "); // domains
  const out: string[] = [];
  for (const m of clean.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = m[0].replace(/,/g, "").replace(/\.$/, "");
    if (n) out.push(n);
  }
  return out;
}

/** Dates written in a text ("23 May 2027", "May 23, 2027", "2027-05-23") as epoch days. */
export function datesIn(text: string): number[] {
  const days: number[] = [];
  const toDay = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m, d) / 86400000);
  for (const m of text.matchAll(/\b(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})\b/g)) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mi >= 0) days.push(toDay(Number(m[3]), mi, Number(m[1])));
  }
  for (const m of text.matchAll(/\b([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mi >= 0) days.push(toDay(Number(m[3]), mi, Number(m[2])));
  }
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) days.push(toDay(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return days;
}

/** Sentences of a caption (lines and full stops), without hashtags and links. */
function sentences(text: string): string[] {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/#\w+/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /[a-zऀ-෿]/i.test(s));
}

const words = (s: string | null | undefined) => (s ?? "").trim().split(/\s+/).filter(Boolean).length;

export type QcInput = {
  post: Pick<
    Post,
    | "id"
    | "platform"
    | "format"
    | "publishOn"
    | "angle"
    | "caption"
    | "hashtags"
    | "posterHeadline"
    | "posterSubline"
    | "posterKicker"
    | "posterCta"
    | "designStatus"
    | "demoParts"
    | "status"
  >;
  brand: Pick<Brand, "name" | "keyFacts" | "description" | "services" | "website" | "city" | "logoKey">;
  campaign: Pick<Campaign, "theme" | "goal" | "keyFacts" | "eventDate" | "location" | "audience" | "callToAction" | "ctaUrl">;
  /** Other posts in the same campaign, to spot repeats. */
  siblings?: { id: number; posterHeadline: string | null }[];
};

/** All the checks for one post. Returns the issues found (empty = all good). */
export function checkPost({ post, brand, campaign, siblings = [] }: QcInput): QcIssue[] {
  const issues: QcIssue[] = [];
  const add = (i: QcIssue) => issues.push(i);
  const caption = (post.caption ?? "").trim();
  const posterText = [post.posterKicker, post.posterHeadline, post.posterSubline, post.posterCta].filter(Boolean).join(" \n ");
  const allText = `${caption}\n${posterText}`;
  const hasPoster = post.format !== "text";

  // 1. Demo content can never go out.
  if (post.demoParts.length > 0) {
    add({ code: "demo", level: "fail", message: `Made by the demo generator, not a real AI (${post.demoParts.join(", ")}). Add an AI key and make it again.` });
  }

  // 2. The caption.
  if (!caption) add({ code: "caption_empty", level: "fail", message: "The caption is empty.", fix: "rewrite" });
  const limit = CAPTION_RULES[post.platform]?.limit;
  if (limit && caption.length > limit) {
    add({ code: "caption_long", level: "fail", message: `Caption is ${caption.length} characters; ${post.platform} allows ${limit}.`, fix: "rewrite" });
  }
  const long = sentences(caption).filter((s) => words(s) > 22);
  if (long.length) {
    add({ code: "long_sentences", level: "warn", message: `${long.length} long sentence${long.length > 1 ? "s" : ""} (over 22 words). Short sentences read better on a phone.`, fix: "rewrite" });
  }
  const hype = HYPE_WORDS.filter((w) => new RegExp(`\\b${w.replace(/[-\s]/g, "[-\\s]")}\\b`, "i").test(allText));
  if (hype.length) add({ code: "hype", level: "warn", message: `Hype words: ${hype.join(", ")}. Say plainly what the reader gets.`, fix: "rewrite" });
  const risky = RISKY_CLAIMS.filter((r) => r.pattern.test(allText)).map((r) => r.label);
  if (risky.length) add({ code: "risky_claim", level: "fail", message: `Promises we can't prove: ${risky.join(", ")}.`, fix: "rewrite" });

  // 3. Facts: every number must come from the Brand Kit, the campaign brief or the post plan.
  const sources = [
    brand.keyFacts,
    brand.description,
    brand.services,
    brand.website,
    brand.city,
    campaign.theme,
    campaign.goal,
    campaign.keyFacts,
    campaign.eventDate,
    campaign.location,
    campaign.audience,
    campaign.callToAction,
    campaign.ctaUrl,
    post.angle,
    post.publishOn,
  ]
    .filter(Boolean)
    .join("\n");
  const known = new Set(numbersIn(sources));
  // Countdowns: "199 days to Prelims" is fine when a known date is 199 days after the publish date.
  const publishDay = Math.round(Date.parse(post.publishOn) / 86400000);
  for (const d of datesIn(sources)) {
    const gap = d - publishDay;
    if (gap > 0) for (const g of [gap - 1, gap, gap + 1, Math.round(gap / 7), Math.round(gap / 30)]) known.add(String(g));
  }
  const unknown = Array.from(new Set(numbersIn(allText))).filter((n) => {
    if (known.has(n)) return false;
    const v = Number(n);
    return !(Number.isFinite(v) && v <= 10 && Number.isInteger(v)); // small counts ("3 tips") are fine
  });
  if (unknown.length) {
    add({
      code: "unknown_numbers",
      level: "fail",
      message: `Numbers not in your Key facts or the campaign brief: ${unknown.slice(0, 6).join(", ")}. Add them to Key facts if they are true.`,
      fix: "rewrite",
    });
  }
  if (!(brand.keyFacts ?? "").trim()) {
    add({ code: "no_key_facts", level: "warn", message: "The Brand Kit has no Key facts, so the AI has little to say that is specific and true." });
  }

  // 4. Hashtags.
  const rule = HASHTAG_RULES[post.platform];
  if (rule) {
    if (post.hashtags.length > rule.max) {
      add({ code: "hashtags_over", level: "fail", message: `${post.hashtags.length} hashtags; ${post.platform} allows ${rule.max}.`, fix: "hashtags" });
    } else if (post.hashtags.length < rule.min) {
      add({ code: "hashtags_under", level: "warn", message: `Only ${post.hashtags.length} hashtag${post.hashtags.length === 1 ? "" : "s"}; ${rule.min}-${rule.max} work best on ${post.platform}.` });
    }
  }

  // 5. The CTA the campaign asked for.
  if (campaign.callToAction && caption) {
    const want = campaign.callToAction.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();
    const have = caption.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "");
    if (want && !have.includes(want) && !(post.posterCta ?? "").toLowerCase().includes(want)) {
      add({ code: "cta_missing", level: "warn", message: `The campaign's call to action "${campaign.callToAction}" is not in the caption or on the poster.`, fix: "rewrite" });
    }
  }

  // 6. The poster.
  if (hasPoster) {
    if (post.designStatus === "failed") add({ code: "poster_failed", level: "fail", message: "The poster could not be made. Try \"New image\"." });
    if (!(post.posterHeadline ?? "").trim()) add({ code: "headline_empty", level: "fail", message: "The poster has no headline.", fix: "rewrite" });
    else if (words(post.posterHeadline) > 9) {
      add({ code: "headline_long", level: "fail", message: `Poster headline has ${words(post.posterHeadline)} words; keep it to 7 so it reads in 1 second.`, fix: "rewrite" });
    }
    if (words(post.posterSubline) > 16) add({ code: "subline_long", level: "warn", message: "Poster sub-line is long; keep it to about 12 words.", fix: "rewrite" });
    if (!brand.logoKey) add({ code: "no_logo", level: "warn", message: "No logo in the Brand Kit, so posters show the brand name instead." });
    const head = (post.posterHeadline ?? "").trim().toLowerCase();
    const twin = head && siblings.find((s) => s.id !== post.id && (s.posterHeadline ?? "").trim().toLowerCase() === head);
    if (twin) add({ code: "duplicate_headline", level: "warn", message: `Same poster headline as post #${twin.id}.`, fix: "rewrite" });
  }

  return issues;
}

export function qcStatusOf(issues: QcIssue[]): QcStatus {
  if (issues.some((i) => i.level === "fail")) return "fail";
  if (issues.length) return "warn";
  return "pass";
}

/** Instructions for the copywriter when it is asked to fix a post. */
export function fixNotes(issues: QcIssue[]): string[] {
  return issues.filter((i) => i.fix === "rewrite").map((i) => i.message);
}
