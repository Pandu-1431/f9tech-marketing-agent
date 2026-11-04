/*
 * Creative standards per platform and format: pixel size, aspect ratio, safe zones (where the
 * app's own buttons and captions cover the picture), hashtag counts and caption lengths.
 * One table, used by the poster maker, the video maker, the copywriter and the UI.
 * Checked Nov 2026; platforms change these, so keep them here and nowhere else.
 */

export type Safe = { top: number; right: number; bottom: number; left: number };
export type CreativeSpec = { width: number; height: number; ratio: string; safe: Safe; label: string };

const FULL_VERTICAL = { width: 1080, height: 1920, ratio: "9:16" };
const NONE: Safe = { top: 0, right: 0, bottom: 0, left: 0 };
// Reels / Shorts: profile row + caption + buttons cover the bottom and right edge.
const REEL_SAFE: Safe = { top: 220, right: 140, bottom: 480, left: 60 };
// Stories: profile bar on top, reply box at the bottom.
const STORY_SAFE: Safe = { top: 250, right: 60, bottom: 340, left: 60 };

export function creativeSpec(platform: string, format: string): CreativeSpec {
  if (format === "reel") return { ...FULL_VERTICAL, safe: REEL_SAFE, label: "Reel / Short 1080×1920 (9:16)" };
  if (format === "story") return { ...FULL_VERTICAL, safe: STORY_SAFE, label: "Story 1080×1920 (9:16)" };
  switch (platform) {
    case "instagram":
    case "facebook":
    case "linkedin":
      // 4:5 portrait takes the most space in mobile feeds on all three.
      return { width: 1080, height: 1350, ratio: "4:5", safe: NONE, label: "Feed 1080×1350 (4:5)" };
    case "x":
      return { width: 1600, height: 900, ratio: "16:9", safe: NONE, label: "Post image 1600×900 (16:9)" };
    case "youtube":
      return { width: 1280, height: 720, ratio: "16:9", safe: { top: 0, right: 200, bottom: 90, left: 0 }, label: "Thumbnail 1280×720 (16:9)" };
    case "google_business":
      return { width: 1200, height: 900, ratio: "4:3", safe: NONE, label: "Update photo 1200×900 (4:3)" };
    default:
      return { width: 1080, height: 1080, ratio: "1:1", safe: NONE, label: "Square 1080×1080 (1:1)" };
  }
}

/** Short-video output: what every platform accepts for vertical video. */
export const VIDEO_SPEC = {
  width: 1080,
  height: 1920,
  fps: 30,
  codec: "H.264 (yuv420p), AAC 44.1 kHz",
  // Instagram Reels and YouTube Shorts both take up to 3 minutes; 20–45 s holds attention best.
  targetSeconds: [20, 45] as const,
};

/** Hashtag rules per platform: [min, max]. Instagram allows at most 5 per post since Dec 2025. */
export const HASHTAG_RULES: Record<string, { min: number; max: number; note: string }> = {
  instagram: { min: 3, max: 5, note: "Instagram allows 5 at most. Mix: 1 brand, 2 niche, 1 local, 1 broad." },
  facebook: { min: 1, max: 3, note: "1-3; hashtags matter little on Facebook." },
  linkedin: { min: 3, max: 5, note: "3-5 professional topics." },
  x: { min: 1, max: 2, note: "1-2; more looks like spam." },
  youtube: { min: 3, max: 5, note: "3-5; the first 3 show above the title. Add #Shorts for Shorts." },
  google_business: { min: 0, max: 0, note: "No hashtags on Google Business Profile." },
};

/** Caption length targets (characters) and the platform's hard limit. */
export const CAPTION_RULES: Record<string, { target: string; limit: number }> = {
  instagram: { target: "80-150 words; first line under 125 characters (shown before \"more\")", limit: 2200 },
  facebook: { target: "40-120 words", limit: 63206 },
  linkedin: { target: "100-200 words; first 2 lines carry the point", limit: 3000 },
  x: { target: "under 260 characters", limit: 280 },
  youtube: { target: "title under 70 characters, then 100-150 words", limit: 5000 },
  google_business: { target: "80-150 words", limit: 1500 },
};

/** Keeps the hashtags inside the platform's limit; campaign/brand tags come first so they survive. */
export function capHashtags(platform: string, tags: string[], format?: string): string[] {
  const rule = HASHTAG_RULES[platform] ?? { max: 5 };
  const clean = Array.from(new Set(tags.map((h) => (h.startsWith("#") ? h : `#${h}`).replace(/\s+/g, "")).filter((h) => h.length > 1)));
  if (platform === "youtube" && format === "reel" && !clean.some((h) => h.toLowerCase() === "#shorts")) clean.splice(Math.max(0, rule.max - 1), 0, "#Shorts");
  return clean.slice(0, rule.max);
}
