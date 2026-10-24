import { beforeEach, describe, expect, it } from "vitest";
import { createBrand, createCampaign, getCampaign, listCampaignPosts } from "@/lib/data";
import { enqueue, processJobs } from "@/jobs/queue";
import { clearProviderOverrides } from "@/agent/router";
import { freshDb, makeWorkspace } from "./helpers";

describe("campaign pipeline (theme -> plan -> copy)", () => {
  beforeEach(async () => {
    await freshDb();
    clearProviderOverrides();
  });

  it("plans the calendar and drafts every post", async () => {
    const { ws } = await makeWorkspace("Vizag Sweets");
    const brand = await createBrand(ws.id, {
      name: "Vizag Sweets",
      city: "Visakhapatnam",
      tone: "warm, festive",
      hashtags: ["#vizagsweets"],
      platforms: ["instagram", "facebook"],
    });
    const campaign = await createCampaign(ws.id, {
      brandId: brand.id,
      theme: "Diwali sweets offer",
      goal: "More walk-ins and pre-orders",
      platforms: ["instagram", "facebook"],
      startDate: "2026-11-01",
      endDate: "2026-11-14",
      postsPerWeek: 2,
    });

    await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: campaign.id }, ws.id);
    await processJobs();

    const done = await getCampaign(ws.id, campaign.id);
    expect(done?.status).toBe("ready");
    expect(done?.strategy).toBeTruthy();

    const posts = await listCampaignPosts(ws.id, campaign.id);
    expect(posts).toHaveLength(8); // 2 weeks x 2 per week x 2 platforms
    for (const p of posts) {
      expect(p.status).toBe("drafted");
      expect(p.caption).toBeTruthy();
      expect(p.hashtags.every((h) => h.startsWith("#"))).toBe(true);
      expect(p.publishOn >= "2026-11-01" && p.publishOn <= "2026-11-14").toBe(true);
      expect(["instagram", "facebook"]).toContain(p.platform);
    }
  });
});

describe("job recovery", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("requeues a job left 'running' after a restart and finishes it", async () => {
    const { getDb, schema } = await import("@/db");
    const { recoverStaleJobs } = await import("@/jobs/queue");
    const { eq } = await import("drizzle-orm");
    const { ws } = await makeWorkspace("Restart Co");
    const brand = await createBrand(ws.id, { name: "Restart Co" });
    const campaign = await createCampaign(ws.id, {
      brandId: brand.id, theme: "Test", platforms: ["instagram"], startDate: "2026-11-01", endDate: "2026-11-03", postsPerWeek: 2,
    });
    const job = await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: campaign.id }, ws.id);
    const db = await getDb();
    await db.update(schema.jobs).set({ status: "running" }).where(eq(schema.jobs.id, job.id)); // simulate a crash mid-job
    expect(await processJobs()).toBe(0); // nothing claimable
    expect(await recoverStaleJobs(10, new Date(Date.now() + 1000))).toBe(1);
    await processJobs();
    expect((await getCampaign(ws.id, campaign.id))?.status).toBe("ready");
  });
});
