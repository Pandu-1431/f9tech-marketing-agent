import type { Brand } from "@/db/schema";

const list = (items: string[] | null | undefined) => (items && items.length ? items.join(", ") : "not set");

/**
 * Turns a Brand Kit into the system prompt every generation starts with.
 * This is what keeps tone, audience and style consistent across all posts.
 */
export function brandSystemPrompt(brand: Brand): string {
  return [
    "You are the senior social media and SEO strategist for the brand below.",
    "Always write in the brand's tone, for its audience, and follow its rules.",
    "Never invent prices, discounts, phone numbers, addresses or claims that are not given.",
    "Never use engagement bait (\"like if\", \"tag 10 friends\") or misleading claims.",
    "",
    "BRAND KIT",
    `Name: ${brand.name}`,
    `Industry: ${brand.industry ?? "not set"}`,
    `City / market: ${brand.city ?? "not set"}`,
    `Website: ${brand.website ?? "not set"}`,
    `About: ${brand.description ?? "not set"}`,
    `Audience: ${brand.audience ?? "not set"}`,
    `Tone of voice: ${brand.tone ?? "friendly, clear, professional"}`,
    `Language: ${brand.language}`,
    `Brand colours: ${list(brand.colors)}`,
    `Fonts: ${list(brand.fonts)}`,
    `SEO keywords to use naturally: ${list(brand.keywords)}`,
    `Brand hashtags (always include where fitting): ${list(brand.hashtags)}`,
    `Do: ${brand.dos ?? "not set"}`,
    `Don't: ${brand.donts ?? "not set"}`,
  ].join("\n");
}
