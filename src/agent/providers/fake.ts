import type { TextProvider, TextRequest, TextResult } from "./types";

/**
 * Deterministic provider for tests and demos (no API key, no network).
 * It recognises the planner and copywriter prompts and returns valid JSON.
 */
export class FakeProvider implements TextProvider {
  readonly name = "fake";
  readonly model = "fake-1";

  async generate(req: TextRequest): Promise<TextResult> {
    const p = req.prompt;
    let text: string;

    if (p.includes("TASK: CAMPAIGN_PLAN")) {
      const count = Number(/POST_COUNT: (\d+)/.exec(p)?.[1] ?? 3);
      const start = /START_DATE: (\d{4}-\d{2}-\d{2})/.exec(p)?.[1] ?? "2026-11-01";
      const platforms = (/PLATFORMS: ([^\n]+)/.exec(p)?.[1] ?? "instagram").split(",").map((s) => s.trim());
      const day = new Date(`${start}T00:00:00Z`);
      text = JSON.stringify({
        strategy: "Build excitement early, show the offer mid-way, push urgency at the end.",
        posts: Array.from({ length: count }, (_, i) => {
          const d = new Date(day.getTime() + i * 2 * 86400000);
          return {
            date: d.toISOString().slice(0, 10),
            platform: platforms[i % platforms.length],
            format: i % 3 === 2 ? "reel" : "image",
            angle: `Angle ${i + 1}: ${[
              "a family opening a gift box together",
              "close-up of fresh sweets being made in the kitchen",
              "behind the scenes: packing festive orders",
              "customer favourite of the week",
              "countdown reminder before the offer ends",
              "the story behind our 40-year-old recipe",
            ][i % 6]}`,
          };
        }),
      });
    } else if (p.includes("TASK: POST_COPY")) {
      const theme = /CAMPAIGN THEME: ([^\n]+)/.exec(p)?.[1] ?? "our offer";
      const platform = /PLATFORM: ([^\n]+)/.exec(p)?.[1] ?? "instagram";
      const angle = (/POST ANGLE: ([^\n]+)/.exec(p)?.[1] ?? "").replace(/^Angle \d+:\s*/, "");
      const brand = /Name: ([^\n]+)/.exec(req.system)?.[1] ?? "us";
      const n = Number(/Angle (\d+)/.exec(p)?.[1] ?? 1);
      const hooks = ["This festive season, make every moment sweeter.", "Your gifting list just got easier.", "Only a few days left!", "Made fresh, shared with love."];
      const hook = hooks[(n - 1) % hooks.length];
      text = JSON.stringify({
        caption:
          platform === "facebook"
            ? `${hook} ${theme} at ${brand}. Idea for today: ${angle}. Drop by this week or message us to pre-order.`
            : `${hook} ✨\n\n${theme} — only at ${brand}.\n${angle}.\n\nTap the link in bio to pre-order 🎁`,
        hashtags: ["#festiveoffer", "#shoplocal", "#vizag"],
        image_prompt: `On-brand photo for ${brand}: ${angle}, brand colours, warm festive light`,
        seo_keywords: ["festive offer", "best deals near me"],
        poster_headline: ["Diwali Gift Boxes 20% Off", "Fresh Sweets, Made Today", "Last 3 Days of the Offer", "Gift Sweetness This Diwali"][(n - 1) % 4],
        poster_cta: ["Order Now", "Visit Today", "Pre-order on WhatsApp"][(n - 1) % 3],
      });
    } else if (p.includes("TASK: REEL_SCRIPT")) {
      const theme = /CAMPAIGN THEME: ([^\n]+)/.exec(p)?.[1] ?? "our offer";
      const brand = /Name: ([^\n]+)/.exec(req.system)?.[1] ?? "us";
      text = JSON.stringify({
        title: `${theme} — reel`,
        scenes: [
          { voiceover: `Looking for the perfect festive gift? Stop scrolling.`, on_screen: "The perfect festive gift?", image_prompt: "festive gift box with sweets, warm light" },
          { voiceover: `At ${brand}, every sweet is made fresh, every single morning.`, on_screen: "Made fresh every morning", image_prompt: "sweets being made in a clean kitchen" },
          { voiceover: `This week only: ${theme}.`, on_screen: "This week only", image_prompt: "beautiful gift boxes stacked on a shop counter" },
          { voiceover: `Pre-order on WhatsApp and pick it up the same day.`, on_screen: "Pre-order today", image_prompt: "smiling customer receiving a gift box" },
        ],
        cta: "Order on WhatsApp",
      });
    } else {
      text = JSON.stringify({ ok: true });
    }

    return { text, inputTokens: Math.ceil(p.length / 4), outputTokens: Math.ceil(text.length / 4) };
  }
}
