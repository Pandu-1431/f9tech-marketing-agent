import { beforeEach, describe, expect, it } from "vitest";
import { createBrand, createCampaign, getCampaign, listCampaignPosts } from "@/lib/data";
import { enqueue, processJobs } from "@/jobs/queue";
import { clearProviderOverrides } from "@/agent/router";
import { batchPrompt, copyPrompt } from "@/agent/copywriter";
import { plannerPrompt } from "@/agent/planner";
import { CAMPAIGN_TYPES } from "@/lib/campaign-types";
import { freshDb, makeWorkspace } from "./helpers";

describe("campaign brief (NGO fields)", () => {
  beforeEach(async () => {
    await freshDb();
    clearProviderOverrides();
  });

  async function eventCampaign() {
    const { ws } = await makeWorkspace("Vizag Volunteers");
    const brand = await createBrand(ws.id, {
      name: "Vizag Volunteers Association",
      city: "Visakhapatnam",
      platforms: ["instagram", "facebook"],
    });
    const campaign = await createCampaign(ws.id, {
      brandId: brand.id,
      campaignType: "event",
      theme: "RK Beach clean-up drive",
      audience: "College students in Vizag",
      keyFacts: "Reporting time 6:45 AM\nGloves and bags provided",
      eventDate: "2026-11-08",
      location: "RK Beach",
      callToAction: "Register now",
      ctaUrl: "https://example.org/join",
      language: "English + Telugu",
      hashtags: ["#VizagBeachCleanup"],
      formats: ["image", "reel"],
      platforms: ["instagram", "facebook"],
      startDate: "2026-11-01",
      endDate: "2026-11-10",
      postsPerWeek: 2,
    });
    return { ws, brand, campaign };
  }

  it("stores the brief with defaults for older-style campaigns", async () => {
    const { ws, brand } = await eventCampaign();
    const plain = await createCampaign(ws.id, {
      brandId: brand.id,
      theme: "Plain campaign",
      platforms: ["instagram"],
      startDate: "2026-11-01",
      endDate: "2026-11-07",
      postsPerWeek: 1,
    });
    expect(plain.campaignType).toBe("general");
    expect(plain.hashtags).toEqual([]);
    expect(plain.formats).toEqual(["image", "carousel", "reel", "story", "text"]);
  });

  it("puts the brief and the type's story arc into the prompts", async () => {
    const { campaign } = await eventCampaign();
    const plan = plannerPrompt(campaign, 4);
    expect(plan).toContain("EVENT_DATE: 2026-11-08");
    expect(plan).toContain("LOCATION: RK Beach");
    expect(plan).toContain("Reporting time 6:45 AM");
    expect(plan).toContain("FORMATS: image, reel");
    expect(plan).toContain(CAMPAIGN_TYPES.event.arc);
    expect(plan).not.toContain(CAMPAIGN_TYPES.general.arc);

    const fakePost = { id: 1, platform: "facebook", format: "image", publishOn: "2026-11-02", angle: "Why join" };
    for (const prompt of [copyPrompt(campaign, fakePost as never), batchPrompt(campaign, [fakePost as never])]) {
      expect(prompt).toContain("CAMPAIGN HASHTAGS (use in every post): #VizagBeachCleanup");
      expect(prompt).toContain('"Register now"');
      expect(prompt).toContain("https://example.org/join");
      expect(prompt).toContain("LANGUAGE: English + Telugu");
    }
  });

  it("plans only allowed formats and adds campaign hashtags to every post", async () => {
    const { ws, campaign } = await eventCampaign();
    await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: campaign.id }, ws.id);
    await processJobs();

    expect((await getCampaign(ws.id, campaign.id))?.status).toBe("ready");
    const posts = await listCampaignPosts(ws.id, campaign.id);
    expect(posts.length).toBeGreaterThan(0);
    for (const p of posts) {
      expect(["image", "reel"]).toContain(p.format);
      expect(p.hashtags[0]).toBe("#VizagBeachCleanup");
    }
  });
});
