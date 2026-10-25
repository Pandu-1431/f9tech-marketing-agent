import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { composePoster, posterSize, wrap, readableOn } from "@/agent/images/poster";
import { FakeImageProvider } from "@/agent/images/providers";
import { generateImage } from "@/agent/images/router";
import { generateText, QuotaExceededError } from "@/agent/router";
import { TrialEndedError, trialInfo } from "@/lib/plan";
import { createBrand, createCampaign, getCampaign, latestPosters, listCampaignPosts } from "@/lib/data";
import { enqueue, processJobs } from "@/jobs/queue";
import { getFile } from "@/lib/storage";
import { freshDb, makeWorkspace } from "./helpers";

describe("poster composer", () => {
  it("wraps long headlines and picks readable text colours", () => {
    expect(wrap("Diwali Gift Boxes 20% Off For The Whole Family This Week", 16, 3)).toHaveLength(3);
    expect(readableOn("#ffffff")).toBe("#111111");
    expect(readableOn("#1d3557")).toBe("#ffffff");
  });

  it("renders every template at the platform size", async () => {
    const { width, height } = posterSize("instagram", "image");
    const bg = (await new FakeImageProvider().generate({ prompt: "x", width, height, colors: ["#E63946", "#F4A261"] })).data;
    for (const template of ["band", "top", "center"] as const) {
      const png = await composePoster({
        background: bg, width, height, template, headline: "Diwali Gift Boxes 20% Off & More <Today>",
        cta: "Order Now", brandName: "Vizag Sweets", colors: ["#E63946", "#F4A261"], footer: "Vizag Sweets · Visakhapatnam",
      });
      const meta = await sharp(png).metadata();
      expect([meta.width, meta.height, meta.format]).toEqual([1080, 1350, "png"]);
    }
    expect(posterSize("instagram", "reel")).toEqual({ width: 1080, height: 1920 });
  });
});

describe("free trial", () => {
  beforeEach(async () => {
    await freshDb();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("blocks all AI generation after the trial ends (when a trial is configured)", async () => {
    vi.stubEnv("AGENT_TRIAL_DAYS", "21");
    const { ws } = await makeWorkspace();
    const db = await getDb();
    await db.update(schema.workspaces).set({ trialEndsAt: new Date(Date.now() - 1000) }).where(eq(schema.workspaces.id, ws.id));
    await expect(generateText({ workspaceId: ws.id, purpose: "t" }, { system: "s", prompt: "p" })).rejects.toBeInstanceOf(TrialEndedError);
    await expect(generateImage({ workspaceId: ws.id, purpose: "t" }, { prompt: "p", width: 64, height: 64 })).rejects.toBeInstanceOf(TrialEndedError);
  });

  it("AGENT_TRIAL_DAYS=0 means no expiry: an old trial date does not block AI", async () => {
    vi.stubEnv("AGENT_TRIAL_DAYS", "0");
    const { ws } = await makeWorkspace();
    const db = await getDb();
    await db.update(schema.workspaces).set({ trialEndsAt: new Date(Date.now() - 86400000) }).where(eq(schema.workspaces.id, ws.id));
    const info = await trialInfo(ws.id);
    expect(info).toMatchObject({ enabled: false, active: true, daysLeft: null });
    await expect(generateText({ workspaceId: ws.id, purpose: "t" }, { system: "s", prompt: "p" })).resolves.toMatchObject({ provider: "fake" });
  });

  it("AGENT_TRIAL_DAYS=0 keeps the monthly usage limits", async () => {
    vi.stubEnv("AGENT_TRIAL_DAYS", "0");
    vi.stubEnv("AGENT_MONTHLY_TEXT_GENERATIONS", "1");
    const { ws } = await makeWorkspace();
    await generateText({ workspaceId: ws.id, purpose: "t" }, { system: "s", prompt: "p" });
    await expect(generateText({ workspaceId: ws.id, purpose: "t" }, { system: "s", prompt: "p" })).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("no trial setting at all defaults to no expiry", async () => {
    vi.stubEnv("AGENT_TRIAL_DAYS", "");
    const { ws } = await makeWorkspace();
    expect((await trialInfo(ws.id)).enabled).toBe(false);
  });

  it("gives new workspaces about 21 days", async () => {
    const { ws } = await makeWorkspace();
    const days = (ws.trialEndsAt.getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(20.9);
    expect(days).toBeLessThan(21.1);
  });
});

describe("design studio pipeline", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("makes a stored poster for every post after writing", async () => {
    const { ws } = await makeWorkspace("Vizag Sweets");
    const brand = await createBrand(ws.id, { name: "Vizag Sweets", colors: ["#E63946", "#F4A261"], platforms: ["instagram"] });
    const campaign = await createCampaign(ws.id, {
      brandId: brand.id, theme: "Diwali sweets offer", platforms: ["instagram", "google_business"],
      startDate: "2026-11-01", endDate: "2026-11-07", postsPerWeek: 2,
    });
    await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: campaign.id }, ws.id);
    await processJobs();

    expect((await getCampaign(ws.id, campaign.id))?.status).toBe("ready");
    const posts = await listCampaignPosts(ws.id, campaign.id);
    const posters = await latestPosters(ws.id, campaign.id);
    expect(posts.length).toBeGreaterThan(0);
    for (const p of posts) {
      expect(p.designStatus).toBe("done");
      expect(p.posterHeadline).toBeTruthy();
      const poster = posters.get(p.id)!;
      const file = await getFile(poster.storageKey);
      const meta = await sharp(file!).metadata();
      expect([meta.width, meta.height]).toEqual([poster.width, poster.height]);
      if (p.platform === "google_business") expect(meta.width).toBe(1200);
    }
  });
});
