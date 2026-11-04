import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";
import { clearProviderOverrides, registerProvider } from "@/agent/router";
import { clearImageProviderOverrides, registerImageProvider } from "@/agent/images/router";
import { FakeProvider } from "@/agent/providers/fake";
import { FakeImageProvider } from "@/agent/images/providers";
import { plannerPrompt } from "@/agent/planner";
import { brandSystemPrompt } from "@/agent/brand-context";
import {
  calendarPosts,
  createBrand,
  createCampaign,
  getCampaign,
  getPost,
  isApprovedForPublish,
  listCampaignPosts,
  reschedulePost,
  reviewPost,
  ScheduleError,
  updatePost,
} from "@/lib/data";
import { enqueue, processJobs } from "@/jobs/queue";
import { monthGrid, shiftMonth, slotFor, utcToZoned, zonedToUtc } from "@/lib/schedule";
import { freshDb, makeWorkspace } from "./helpers";

describe("schedule helpers", () => {
  it("converts local time to UTC and back (IST has no daylight saving)", () => {
    const d = zonedToUtc("2026-11-08", "19:00", "Asia/Kolkata");
    expect(d.toISOString()).toBe("2026-11-08T13:30:00.000Z");
    expect(utcToZoned(d, "Asia/Kolkata")).toEqual({ date: "2026-11-08", time: "19:00" });
  });

  it("handles daylight saving (New York, London)", () => {
    expect(zonedToUtc("2026-07-01", "09:00", "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedToUtc("2026-12-01", "09:00", "America/New_York").toISOString()).toBe("2026-12-01T14:00:00.000Z");
    expect(zonedToUtc("2026-06-15", "18:00", "Europe/London").toISOString()).toBe("2026-06-15T17:00:00.000Z");
  });

  it("a late-evening IST slot can fall on the previous UTC day but keeps its local date", () => {
    const d = zonedToUtc("2026-11-08", "02:00", "Asia/Kolkata");
    expect(d.toISOString()).toBe("2026-11-07T20:30:00.000Z");
    expect(utcToZoned(d, "Asia/Kolkata").date).toBe("2026-11-08");
  });

  it("builds Monday-first month grids", () => {
    const nov = monthGrid("2026-11"); // 1 Nov 2026 is a Sunday
    expect(nov.first).toBe("2026-10-26");
    expect(nov.weeks.every((w) => w.length === 7)).toBe(true);
    expect(nov.weeks.flat()).toContain("2026-11-30");
    expect(nov.last >= "2026-11-30").toBe(true);
    const feb = monthGrid("2027-02"); // starts Monday, 28 days
    expect(feb.first).toBe("2027-02-01");
    expect(feb.weeks.length).toBe(4);
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
});

function useStubRealProviders() {
  const text = new FakeProvider();
  registerProvider({ name: "gemini", model: "stub-model", generate: (r) => text.generate(r) });
  const img = new FakeImageProvider();
  registerImageProvider({ name: "cloudflare", model: "stub-image", generate: (r) => img.generate(r) });
  vi.stubEnv("AGENT_TEXT_CHAIN", "gemini");
  vi.stubEnv("AGENT_IMAGE_CHAIN", "cloudflare");
}

async function runCampaign(name: string, brandExtra: { timezone?: string; services?: string } = {}) {
  const { ws, user } = await makeWorkspace(name);
  const brand = await createBrand(ws.id, { name, colors: ["#123456"], platforms: ["instagram", "linkedin"], ...brandExtra });
  const campaign = await createCampaign(ws.id, {
    brandId: brand.id,
    theme: "Year-end offers",
    platforms: ["instagram", "linkedin"],
    startDate: "2026-11-02",
    endDate: "2026-11-08",
    postsPerWeek: 2,
  });
  await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: campaign.id }, ws.id);
  await processJobs();
  return { ws, user, brand, campaign, posts: await listCampaignPosts(ws.id, campaign.id) };
}

describe("scheduling and calendar", () => {
  beforeEach(async () => {
    await freshDb();
    clearProviderOverrides();
    clearImageProviderOverrides();
    useStubRealProviders();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    clearProviderOverrides();
    clearImageProviderOverrides();
  });

  it("planned posts get a time slot in the brand's time zone", async () => {
    const { posts } = await runCampaign("Slots Co", { timezone: "Asia/Kolkata" });
    expect(posts.length).toBeGreaterThan(0);
    for (const p of posts) {
      expect(p.scheduledAt).not.toBeNull();
      expect(p.timezone).toBe("Asia/Kolkata");
      const local = utcToZoned(p.scheduledAt!, p.timezone);
      expect(local.date).toBe(p.publishOn);
      expect(local.time).toMatch(/^\d{2}:\d{2}$/);
    }
    // The stand-in model gives no times, so the platform's default slot is used.
    const insta = posts.find((p) => p.platform === "instagram");
    if (insta) expect(utcToZoned(insta.scheduledAt!, "Asia/Kolkata").time).toBe(slotFor("instagram"));
  });

  it("the planner prompt and brand prompt include the brand's services", async () => {
    const { ws, brand, campaign } = await runCampaign("Services Co", { services: "Wedding sweets boxes\n- Corporate Diwali gifting\n\nSugar-free range" });
    const c = (await getCampaign(ws.id, campaign.id))!;
    const prompt = plannerPrompt(c, 4, brand);
    expect(prompt).toContain("SERVICES: Wedding sweets boxes; Corporate Diwali gifting; Sugar-free range");
    expect(prompt).toContain("Spread the posts across the SERVICES");
    expect(brandSystemPrompt(brand)).toContain("Services / products: Wedding sweets boxes; Corporate Diwali gifting; Sugar-free range");
    expect(plannerPrompt(c, 4, { services: null })).not.toContain("SERVICES:");
  });

  it("reschedule moves date and time, keeps the time when only the date changes, and keeps approval", async () => {
    const { ws, user, posts } = await runCampaign("Move Co");
    const post = (await getPost(ws.id, posts[0].id))!;
    await reviewPost(ws.id, post.id, "approved", null, { userId: user.id, version: post.currentVersion });
    const before = utcToZoned(post.scheduledAt!, post.timezone).time;

    const moved = (await reschedulePost(ws.id, post.id, { date: "2026-11-20" }))!;
    expect(moved.publishOn).toBe("2026-11-20");
    expect(utcToZoned(moved.scheduledAt!, moved.timezone)).toEqual({ date: "2026-11-20", time: before });
    expect(isApprovedForPublish(moved)).toBe(true); // schedule is not content

    const timed = (await reschedulePost(ws.id, post.id, { date: "2026-11-21", time: "08:15" }))!;
    expect(timed.scheduledAt!.toISOString()).toBe("2026-11-21T02:45:00.000Z");
  });

  it("reschedule refuses bad input, published posts, and other workspaces' posts", async () => {
    const { ws, posts } = await runCampaign("Guard Co");
    const id = posts[0].id;
    await expect(reschedulePost(ws.id, id, { date: "2026-13-40" })).rejects.toBeInstanceOf(ScheduleError);
    await expect(reschedulePost(ws.id, id, { date: "2026-11-20", time: "25:00" })).rejects.toBeInstanceOf(ScheduleError);

    const { ws: other } = await makeWorkspace("Other Co");
    expect(await reschedulePost(other.id, id, { date: "2026-12-01" })).toBeNull();
    const db = await getDb();
    const [row] = await db.select().from(schema.posts).where(eq(schema.posts.id, id));
    expect(row.publishOn).toBe(posts[0].publishOn);

    await updatePost(ws.id, id, { status: "published" });
    await expect(reschedulePost(ws.id, id, { date: "2026-12-01" })).rejects.toBeInstanceOf(ScheduleError);
  });

  it("the calendar shows posts across campaigns and brands of one workspace only, with a brand filter", async () => {
    const a = await runCampaign("Cal A");
    const brand2 = await createBrand(a.ws.id, { name: "Second Brand", platforms: ["instagram"] });
    const c2 = await createCampaign(a.ws.id, { brandId: brand2.id, theme: "Second", platforms: ["instagram"], startDate: "2026-11-10", endDate: "2026-11-12", postsPerWeek: 2 });
    await enqueue("campaign.plan", { workspaceId: a.ws.id, campaignId: c2.id }, a.ws.id);
    await processJobs();
    const b = await runCampaign("Cal B");

    const all = await calendarPosts(a.ws.id, { from: "2026-10-26", to: "2026-12-06" });
    expect(new Set(all.map((p) => p.brandName))).toEqual(new Set(["Cal A", "Second Brand"]));
    expect(all.some((p) => b.posts.some((bp) => bp.id === p.id))).toBe(false);
    expect(all.every((p) => p.posterKey !== undefined)).toBe(true);

    const filtered = await calendarPosts(a.ws.id, { from: "2026-10-26", to: "2026-12-06", brandId: brand2.id });
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((p) => p.brandName === "Second Brand")).toBe(true);
    // Another workspace's brand id gives nothing.
    expect(await calendarPosts(b.ws.id, { from: "2026-10-26", to: "2026-12-06", brandId: brand2.id })).toEqual([]);
  });
});
