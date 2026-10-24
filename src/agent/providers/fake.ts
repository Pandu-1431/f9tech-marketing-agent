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
            angle: `Angle ${i + 1}: show the product in a real customer moment`,
          };
        }),
      });
    } else if (p.includes("TASK: POST_COPY")) {
      text = JSON.stringify({
        caption: "Fresh look, festive deals. Visit us this week and save more. 🎉",
        hashtags: ["#festiveoffer", "#shoplocal", "#vizag"],
        image_prompt: "Bright festive product photo, brand colours, clean background, warm light",
        seo_keywords: ["festive offer", "best deals near me"],
      });
    } else {
      text = JSON.stringify({ ok: true });
    }

    return { text, inputTokens: Math.ceil(p.length / 4), outputTokens: Math.ceil(text.length / 4) };
  }
}
