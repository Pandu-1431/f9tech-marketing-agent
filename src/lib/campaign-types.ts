/**
 * Campaign types. Each one gives the planner its own story arc, so an event countdown,
 * a volunteer drive and a fundraiser are not all planned like a sales offer.
 */
export const CAMPAIGN_TYPES = {
  general: {
    label: "General promotion",
    arc: "Build a story: awareness first, then value/offer, then urgency/reminder.",
  },
  awareness: {
    label: "Cause awareness",
    arc: "Build a story: the problem and why it matters locally, then facts, then what the organisation does about it, then how people can help.",
  },
  event: {
    label: "Event promotion",
    arc: "Build a story around EVENT_DATE: announce the event, then why join and what to expect, then countdown reminders in the last days before EVENT_DATE, then a thank-you/recap after it if the campaign runs past EVENT_DATE.",
  },
  volunteer_drive: {
    label: "Volunteer recruitment",
    arc: "Build a story: the need, then what volunteers actually do (real moments, testimonials), then how easy it is to join, then a final call before the campaign ends.",
  },
  fundraising: {
    label: "Fundraising / donation drive",
    arc: "Build a story: the need, then what a donation makes possible (only amounts given in KEY FACTS), then progress and stories, then a final push before the campaign ends.",
  },
  observance: {
    label: "Special day / observance",
    arc: "Build up a few days before the day, put the main message on the day itself (EVENT_DATE when given), then a short follow-up on what people can do next.",
  },
  impact_story: {
    label: "Impact story / recap",
    arc: "Lead with the outcome (only numbers given in KEY FACTS), then the people behind it, then thanks to volunteers and partners, then an invite to the next activity.",
  },
} as const;

export type CampaignType = keyof typeof CAMPAIGN_TYPES;

export const CAMPAIGN_TYPE_KEYS = Object.keys(CAMPAIGN_TYPES) as CampaignType[];

export function campaignTypeLabel(type: string): string {
  return CAMPAIGN_TYPES[type as CampaignType]?.label ?? type;
}

export function campaignArc(type: string): string {
  return (CAMPAIGN_TYPES[type as CampaignType] ?? CAMPAIGN_TYPES.general).arc;
}

/** Suggested calls to action shown in the form (free text is allowed too). */
export const CTA_SUGGESTIONS = ["Volunteer now", "Register now", "Donate now", "Join us", "Learn more", "Share this", "Order now"];

export const FORMAT_LABELS: Record<string, string> = {
  image: "Poster",
  carousel: "Carousel",
  reel: "Reel video",
  story: "Story",
  text: "Text only",
};
