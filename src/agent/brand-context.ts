import type { Brand } from "@/db/schema";
import { memoryLines } from "./memory";
import { seoKitLines } from "./seo-lines";
import { brandFactsBlock, simpleLanguageRules } from "./style";

const list = (items: string[] | null | undefined) => (items && items.length ? items.join(", ") : "not set");

/** The brand's services, one per line in the Brand Kit. */
export function brandServices(brand: Pick<Brand, "services">): string[] {
  return (brand.services ?? "")
    .split(/\r?\n/)
    .map((s) => s.replace(/^[-*•\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 30);
}

/**
 * Turns a Brand Kit into the system prompt every generation starts with.
 * This is what keeps tone, audience and style consistent across all posts.
 */
export function brandSystemPrompt(brand: Brand, memory: string[] = []): string {
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
    `Services / products: ${brandServices(brand).join("; ") || "not set"}`,
    `Audience: ${brand.audience ?? "not set"}`,
    `Tone of voice: ${brand.tone ?? "friendly, clear, professional"}`,
    `Language: ${brand.language}`,
    `Brand colours: ${list(brand.colors)}`,
    `Fonts: ${list(brand.fonts)}`,
    `Visual style: ${brand.visualStyle ?? "real Indian people and places, natural light"}`,
    `SEO keywords to use naturally: ${list(brand.keywords)}`,
    `Brand hashtags (always include where fitting): ${list(brand.hashtags)}`,
    `Do: ${brand.dos ?? "not set"}`,
    `Don't: ${brand.donts ?? "not set"}`,
    ...brandFactsBlock(brand),
    ...seoKitLines(brand.seoKit),
    "",
    ...simpleLanguageRules(brand),
    ...memory,
  ].join("\n");
}

/**
 * The same prompt plus the brand's memory (learnings from results, reviewer rules).
 * Load it once per job and pass `memory` on, instead of calling this for every post.
 */
export async function brandSystemPromptWithMemory(brand: Brand, memory?: string[]): Promise<string> {
  return brandSystemPrompt(brand, memory ?? (await memoryLines(brand.workspaceId, brand.id)));
}
