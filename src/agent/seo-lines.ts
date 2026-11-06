import type { SeoKit } from "@/db/schema";

/** Lines for the writing prompts (empty until a kit is built). */
export function seoKitLines(kit: SeoKit | null | undefined): string[] {
  if (!kit || (!kit.keywords.length && !Object.values(kit.hashtagSets).flat().length)) return [];
  const sets = kit.hashtagSets;
  const line = (label: string, list: string[]) => (list.length ? `${label}: ${list.join(" ")}` : "");
  return [
    "",
    "SEO KIT (from real Google/YouTube searches; use the keywords that fit the post, naturally):",
    kit.keywords.length ? `Keywords: ${kit.keywords.slice(0, 16).map((k) => k.phrase).join("; ")}` : "",
    "Hashtag sets (mix across sets within the platform's limit: 1 brand, then niche, local, broad):",
    line("- brand", sets.brand),
    line("- niche", sets.niche),
    line("- local", sets.local),
    line("- broad", sets.broad),
  ].filter(Boolean);
}
