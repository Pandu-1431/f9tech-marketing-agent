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
    } else if (p.includes("TASK: POST_COPY_BATCH")) {
      const ids = [...p.matchAll(/- id (\d+) \| platform (\w+)[^\n]*angle: ([^\n]*)/g)];
      const theme = /CAMPAIGN THEME: ([^\n]+)/.exec(p)?.[1] ?? "our offer";
      const brand = /Name: ([^\n]+)/.exec(req.system)?.[1] ?? "us";
      const hooks = ["This festive season, make every moment sweeter.", "Your gifting list just got easier.", "Only a few days left!", "Made fresh, shared with love."];
      text = JSON.stringify({
        posts: ids.map(([, id, platform, angle], i) => {
          const a = angle.replace(/^Angle \d+:\s*/, "");
          const n = Number(/Angle (\d+)/.exec(angle)?.[1] ?? i + 1);
          const hook = hooks[(n - 1) % hooks.length];
          return {
            id: Number(id),
            caption:
              platform === "facebook"
                ? `${hook} ${theme} at ${brand}. Idea for today: ${a}. Drop by this week or message us to pre-order.`
                : `${hook} ✨\n\n${theme} — only at ${brand}.\n${a}.\n\nTap the link in bio to pre-order 🎁`,
            hashtags: ["#festiveoffer", "#shoplocal", "#vizag"],
            image_prompt: `On-brand photo for ${brand}: ${a}, brand colours, warm festive light`,
            seo_keywords: ["festive offer", "best deals near me"],
            poster_headline: ["Diwali Gift Boxes 20% Off", "Fresh Sweets, Made Today", "Last 3 Days of the Offer", "Gift Sweetness This Diwali"][(n - 1) % 4],
            poster_cta: ["Order Now", "Visit Today", "Pre-order on WhatsApp"][(n - 1) % 3],
            poster_subline: ["Made fresh every morning.", "Gift boxes for every budget.", "Pre-order today, pick up tomorrow.", ""][(n - 1) % 4],
            poster_kicker: ["Diwali", "Tip", "", "New"][(n - 1) % 4],
            poster_template: ["band", "tip", "bignumber", "split"][(n - 1) % 4],
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
        poster_subline: ["Made fresh every morning.", "Gift boxes for every budget.", "Pre-order today, pick up tomorrow.", ""][(n - 1) % 4],
        poster_kicker: ["Diwali", "Tip", "", "New"][(n - 1) % 4],
        poster_template: ["band", "tip", "bignumber", "split"][(n - 1) % 4],
      });
    } else if (p.includes("TASK: WEEKLY_THEME")) {
      const service = /SERVICES \/ FEATURES: ([^;\n]+)/.exec(p)?.[1];
      const date = /DATES THAT MATTER:\n- \d{4}-\d{2}-\d{2}: ([^\n(]+)/.exec(p)?.[1]?.trim();
      text = JSON.stringify({
        theme: date ? `Celebrate ${date}` : service ? `Spotlight: ${service}` : "Why people choose us",
        goal: "Grow reach and enquiries this week",
        campaign_type: date ? "observance" : "general",
        call_to_action: "Message us today",
        why: date ? "A national day falls this week" : "This service had no recent week",
      });
    } else if (p.includes("TASK: REEL_SCRIPT")) {
      const theme = /CAMPAIGN THEME: ([^\n]+)/.exec(p)?.[1] ?? "our offer";
      const brand = /Name: ([^\n]+)/.exec(req.system)?.[1] ?? "us";
      text = JSON.stringify({
        title: `${theme} — reel`,
        scenes: [
          { voiceover: `Looking for the perfect festive gift? Stop scrolling.`, on_screen: "The perfect festive gift?", image_prompt: "festive gift box with sweets, warm light" },
          { voiceover: `At ${brand}, every sweet is made fresh, every single morning.`, on_screen: "Made fresh every morning", image_prompt: "sweets being made in a clean kitchen", ...(p.includes("PRODUCT SHOTS") ? { shot: 1 } : {}) },
          { voiceover: `This week only: ${theme}.`, on_screen: "This week only", image_prompt: "beautiful gift boxes stacked on a shop counter" },
          { voiceover: `Pre-order on WhatsApp and pick it up the same day.`, on_screen: "Pre-order today", image_prompt: "smiling customer receiving a gift box" },
        ],
        cta: "Order on WhatsApp",
      });
      // Video styles: shape the same four scenes like the style asks.
      const style = /STYLE: (PRESENTER|THEME|CONCEPT|TEXT)/.exec(p)?.[1];
      if (style) {
        const out = JSON.parse(text) as { look?: string; scenes: Record<string, unknown>[] };
        const steps = ["The problem", "The idea", "How it works", "Start today"];
        out.scenes = out.scenes.map((sc, i) => ({
          ...sc,
          kind: style === "TEXT" ? "text" : style === "PRESENTER" && i % 2 === 0 ? "presenter" : "broll",
          ...(style === "CONCEPT" ? { step: steps[i] } : {}),
          ...(style === "TEXT" ? { image_prompt: "" } : {}),
        }));
        if (style === "PRESENTER") out.scenes.push({ kind: "presenter", voiceover: "See you at the shop. Bye!", on_screen: "See you soon", image_prompt: "" });
        if (style === "THEME") out.look = "Diwali night, warm diyas, marigold garlands, gold and maroon";
        text = JSON.stringify(out);
      }
    } else if (p.includes("TASK: BRAND_FROM_SITE")) {
      const title = /SITE NAME: ([^\n]*)/.exec(p)?.[1]?.trim() || /TITLE: ([^\n|]*)/.exec(p)?.[1]?.trim() || "Business";
      const page = p.split("PAGE TEXT:")[1] ?? "";
      const lines = page.split("\n").map((l) => l.trim()).filter((l) => l.length > 20 && !l.startsWith("Fill ") && !l.startsWith("- ") && !l.startsWith("Reply "));
      text = JSON.stringify({
        name: title, industry: "Local business", city: "", description: lines[0] ?? "", audience: "People nearby who need this",
        tone: "Warm, clear, helpful", language: "English", services: lines.slice(1, 3), key_facts: lines.slice(0, 3),
        keywords: [`${title.toLowerCase()} near me`], hashtags: [`#${title.replace(/\s+/g, "")}`], dos: "Show real products", donts: "No fake claims",
      });
    } else if (p.includes("TASK: MARKETING_PLAN")) {
      const service = /SERVICES \/ FEATURES: ([^;\n]+)/.exec(p)?.[1] ?? "our main service";
      text = JSON.stringify({
        summary: "Build trust with useful posts, then turn attention into action with clear offers. Reels lead because short video reaches new people.",
        pillars: [
          { name: "Helpful tips", share: 40, example: "3 mistakes to avoid" },
          { name: "Product / service", share: 35, example: `How ${service} works` },
          { name: "Proof", share: 25, example: "A customer story" },
        ],
        weeks: [1, 2, 3, 4].map((n) => ({ theme: n === 1 ? `Spotlight: ${service}` : `Week ${n}: tips that help`, campaign_type: "general", call_to_action: "Message us today", formats: ["image", "reel"], why: "Mix reach and action" })),
        kpis: [{ metric: "reach", target: "1,000 per week" }, { metric: "link clicks", target: "20 per week" }],
      });
    } else if (p.includes("TASK: WEEKLY_REVIEW")) {
      const none = /0 published/.test(p);
      text = JSON.stringify({
        review: none ? "No posts were published last week, so there are no results to judge." : "Reels reached more people than posters.",
        changes: none ? ["Approve posts early in the week so they go out on time"] : ["Make more reels", "Put the link in the first line"],
      });
    } else if (p.includes("TASK: BLOG_ARTICLE")) {
      const topic = /TOPIC: ([^\n]+)/.exec(p)?.[1] ?? "Our guide";
      const cta = /CALL TO ACTION LINK: ([^\n]+)/.exec(p)?.[1];
      const para = "This guide explains the basics in plain words, with simple steps you can follow today and the mistakes most people make at the start.";
      text = JSON.stringify({
        title: topic.slice(0, 60),
        slug: topic,
        meta_description: `${topic}: a simple, practical guide with steps, examples and common mistakes to avoid. Read it in five minutes.`.slice(0, 155),
        keyword: topic.toLowerCase(),
        body: [para, "", "## Why it matters", para, "", "## Step by step", "1. Start small", "2. Keep going every day", "3. **Check** your progress", "", "## Mistakes to avoid", "- Doing too much at once", "- Skipping the basics", "", "## Get started", cta ? `Ready? [Talk to us](${cta}).` : "Ready? Message us today."].join("\n"),
        faq: [{ q: `How long does ${topic.toLowerCase()} take?`, a: "Most people see progress in a few weeks." }],
      });
    } else if (p.includes("TASK: SEO_KIT")) {
      const searches = [...p.matchAll(/^- (.+)$/gm)].map((m) => m[1]).filter((s) => !s.startsWith("none available"));
      const city = (/City \/ market: ([^\n]+)/.exec(req.system)?.[1] ?? "").replace("not set", "").trim();
      const brand = (/Name: ([^\n]+)/.exec(req.system)?.[1] ?? "brand").replace(/\s+/g, "");
      text = JSON.stringify({
        keywords: (searches.length ? searches : ["best offers near me", "how to choose a gift"]).slice(0, 12).map((phrase, i) => ({
          phrase,
          intent: ["learn", "compare", "buy", "local"][i % 4],
          cluster: phrase.split(" ").slice(0, 2).join(" "),
        })),
        questions: ["What is the best gift for Diwali?", "Where to buy fresh sweets near me?"],
        hashtag_sets: { brand: [`#${brand}`], niche: ["#freshsweets", "#giftbox"], local: city ? [`#${city.replace(/\s+/g, "")}`] : [], broad: ["#diwali", "#festive"] },
      });
    } else if (p.includes("TASK: EDIT_LESSON")) {
      const before = /BEFORE: ([^\n]*)/.exec(p)?.[1] ?? "";
      const after = /AFTER: ([^\n]*)/.exec(p)?.[1] ?? "";
      const shorter = after.length < before.length * 0.8;
      text = JSON.stringify({ rule: shorter ? "Keep captions short and get to the point in the first line." : "Write in a warmer, more personal voice.", general: true });
    } else {
      text = JSON.stringify({ ok: true });
    }

    return { text, inputTokens: Math.ceil(p.length / 4), outputTokens: Math.ceil(text.length / 4) };
  }
}
