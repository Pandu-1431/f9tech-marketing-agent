import { beforeEach, describe, expect, it } from "vitest";
import { fitsPlatform, formatScorecard, hasHype, onBrandCheck, readability, scorecard } from "@/agent/eval/scorecard";
import { enqueue, processJobs } from "@/jobs/queue";
import { createBrand, createCampaign, getCampaign, listCampaignPosts } from "@/lib/data";
import { freshDb, makeWorkspace } from "./helpers";

/*
 * The scorecard is what `npm run eval` prints: it turns a week of posts into numbers,
 * so a prompt change can be judged before it ships.
 */
describe("agent scorecard", () => {
  it("measures readability, hype and platform fit", () => {
    expect(readability("Start today. A daily plan sized to your free time helps you keep going every single day without fail.")).toEqual({ sentences: 2, short: 1 });
    expect(hasHype("Unlock your potential")).toBe(true);
    expect(hasHype("Start your daily plan")).toBe(false);
    expect(fitsPlatform({ platform: "x", caption: "a".repeat(300), hashtags: [] })).toBe(false);
    expect(fitsPlatform({ platform: "instagram", caption: "ok", hashtags: ["#a", "#b", "#c", "#d", "#e", "#f", "#g", "#h"] })).toBe(false);
    expect(fitsPlatform({ platform: "instagram", caption: "ok", hashtags: ["#a"] })).toBe(true);
  });

  it("checks the brand hashtag, a call to action and brand vocabulary", () => {
    const brand = { name: "Chakravyuh", hashtags: ["#Chakravyuh"], keywords: ["UPSC daily plan"], services: "Daily study plan\nPYQ" };
    const campaign = { callToAction: "Open the app", hashtags: [] };
    const base = { id: 1, platform: "instagram", format: "image", publishOn: "2026-11-09", angle: null, hashtags: ["#chakravyuh"], posterHeadline: null, posterSubline: null, posterKicker: null, posterCta: null, posterTemplate: "band", designStatus: "done", demoParts: [], status: "drafted", seoKeywords: [] };
    expect(onBrandCheck({ ...base, caption: "Your UPSC daily plan is ready. Open the app today." }, brand, campaign)).toEqual({ tag: true, cta: true, keyword: true });
    expect(onBrandCheck({ ...base, hashtags: [], caption: "Nice weather." }, brand, campaign)).toEqual({ tag: false, cta: false, keyword: false });
  });

  describe("on a generated week", () => {
    beforeEach(async () => {
      await freshDb();
    });

    it("scores the built-in generator's week and prints a table", async () => {
      const { ws } = await makeWorkspace("Eval");
      const brand = await createBrand(ws.id, { name: "Chakravyuh", hashtags: ["#Chakravyuh"], keywords: ["UPSC daily plan"], platforms: ["instagram", "facebook"], keyFacts: "Free, no ads" });
      const c = await createCampaign(ws.id, { brandId: brand.id, theme: "Prelims countdown", platforms: ["instagram", "facebook"], startDate: "2026-11-09", endDate: "2026-11-15", postsPerWeek: 3, callToAction: "Open the free app" });
      await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: c.id }, ws.id);
      await processJobs();
      const posts = await listCampaignPosts(ws.id, c.id);
      const card = scorecard(posts, brand, (await getCampaign(ws.id, c.id))!);
      expect(card.posts).toBe(6);
      for (const k of ["safe", "clean", "readable", "plain", "variety", "onBrand", "fits", "finished", "overall"] as const) {
        expect(card[k]).toBeGreaterThanOrEqual(0);
        expect(card[k]).toBeLessThanOrEqual(100);
      }
      expect(card.fits).toBe(100);
      expect(card.finished).toBe(100);
      const table = formatScorecard(card, { ...card, overall: card.overall - 5 });
      expect(table).toContain("Overall");
      expect(table).toContain("(+5)");
      expect(scorecard([], brand, c).posts).toBe(0);
    });
  });
});
