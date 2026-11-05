/** Poster template list and labels (no image code, safe to import anywhere). */

export const POSTER_TEMPLATES = ["band", "top", "center", "split", "bignumber", "tip", "question", "announcement", "quote"] as const;
export type PosterTemplate = (typeof POSTER_TEMPLATES)[number];

/** Label for the UI and "best for" guidance for the copywriter, per template. */
export const TEMPLATE_INFO: Record<PosterTemplate, { label: string; bestFor: string }> = {
  band: { label: "Bottom band", bestFor: "general posts with a strong photo" },
  top: { label: "Top headline", bestFor: "offers and messages where the photo's subject sits low" },
  center: { label: "Centre card", bestFor: "one short, bold message" },
  split: { label: "Photo + panel", bestFor: "features, services, explainers with a sub-line" },
  bignumber: { label: "Big number", bestFor: "stats, countdowns, prices (the headline MUST start with or contain the number, e.g. \"199 days to Prelims\")" },
  tip: { label: "Tip card", bestFor: "tips, how-tos, daily advice" },
  question: { label: "Question card", bestFor: "quiz or question of the day, polls (headline = the question)" },
  announcement: { label: "Announcement", bestFor: "launches, news, events, new features" },
  quote: { label: "Quote", bestFor: "a real quote or testimonial (sub-line = who said it; never invent quotes)" },
};

export function isPosterTemplate(t: string | null | undefined): t is PosterTemplate {
  return (POSTER_TEMPLATES as readonly string[]).includes(t ?? "");
}
