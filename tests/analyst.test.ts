import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { brandResults, queueDueAnalysts, runAnalyst, scoredPosts } from "@/agent/analyst";
import { facebookMetrics, instagramMetrics, readMetrics, youtubeMetrics } from "@/agent/analyst/fetch";
import { bestGroup, deriveLearnings, engagementRate, engagementScore, hookType, lengthBucket, MIN_POSTS_PER_GROUP, type ScoredPost } from "@/agent/analyst/score";
import { listMemory } from "@/agent/memory";
import { brandSystemPromptWithMemory } from "@/agent/brand-context";
import { getDb, schema } from "@/db";
import { enqueue, processJobs } from "@/jobs/queue";
import { createBrand, createCampaign, listCampaignPosts } from "@/lib/data";
import { encryptSecret } from "@/lib/secrets";
import { freshDb, makeWorkspace } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("analyst maths", () => {
  it("scores engagement: comments, shares and saves count more than likes; views a little", () => {
    expect(engagementScore({ likes: 10 })).toBe(10);
    expect(engagementScore({ likes: 10, comments: 5, shares: 2, saves: 1, views: 1000 })).toBe(10 + 10 + 6 + 3 + 10);
    expect(engagementScore({})).toBe(0);
    expect(engagementRate({ likes: 20, reach: 400 })).toBe(5); // 5 per 100 reached
    expect(engagementRate({ likes: 20 })).toBeNull();
  });

  it("reads the caption hook and length", () => {
    expect(hookType("Did you revise polity today?\nMore...")).toBe("question");
    expect(hookType("199 days to Prelims")).toBe("number");
    expect(hookType("🔥 Hot tip")).toBe("emoji");
    expect(hookType("You can do this.")).toBe("you");
    expect(hookType("Daily plan, sized to your time.")).toBe("statement");
    expect(hookType("")).toBe("none");
    expect(lengthBucket("one two three")).toBe("short");
    expect(lengthBucket(Array(50).fill("w").join(" "))).toBe("medium");
    expect(lengthBucket(Array(100).fill("w").join(" "))).toBe("long");
  });

  it("never draws a conclusion from too few posts or a small difference", () => {
    const items = (scores: number[], g: string) => scores.map((score) => ({ score, g }));
    expect(bestGroup([...items([10, 10], "a"), ...items([1, 1, 1], "b")], (x) => x.g)).toBeNull(); // a has only 2
    expect(bestGroup([...items([10, 10, 10], "a"), ...items([9, 9, 9], "b")], (x) => x.g)).toBeNull(); // only 11% better
    expect(bestGroup([...items([10, 10, 10], "a"), ...items([2, 2, 2], "b")], (x) => x.g)).toEqual({ group: "a", lift: 5, count: 3, avg: 10 });
    expect(MIN_POSTS_PER_GROUP).toBe(3);
  });

  it("turns results into plain-English learnings with the numbers the planner needs", () => {
    const post = (i: number, over: Partial<ScoredPost>): ScoredPost => ({
      postId: i,
      platform: "instagram",
      format: "image",
      template: "band",
      time: "13:00",
      caption: "Daily plan for busy aspirants.",
      angle: `Angle ${i}`,
      headline: `Headline ${i}`,
      score: 2,
      metrics: { likes: 2 },
      ...over,
    });
    const posts = [
      ...[1, 2, 3, 4].map((i) => post(i, { format: "reel", time: "19:30", template: "tip", caption: "Did you know? 3 tips", score: 20, metrics: { likes: 10, comments: 5 } })),
      ...[5, 6, 7, 8].map((i) => post(i, {})),
    ];
    const learnings = deriveLearnings(posts);
    const topics = learnings.map((l) => l.topic);
    expect(topics).toContain("format");
    expect(topics).toContain("time");
    expect(topics).toContain("template");
    expect(topics).toContain("hook");
    expect(topics).toContain("example");
    const format = learnings.find((l) => l.topic === "format")!;
    expect(format.text).toMatch(/On instagram, reels get \d+(\.\d+)?x the engagement/);
    expect(format.data).toMatchObject({ platform: "instagram", format: "reel" });
    expect(format.weight).toBe(4);
    const time = learnings.find((l) => l.topic === "time")!;
    expect(time.data).toMatchObject({ platform: "instagram", time: "19:00", bucket: "evening" });
    expect(learnings.filter((l) => l.topic === "example").length).toBeLessThanOrEqual(3);
    // Not enough data: no learnings at all (the agents fall back to the Brand Kit).
    expect(deriveLearnings(posts.slice(0, 4))).toEqual([]);
  });
});

describe("metric readers", () => {
  it("Facebook: likes/comments/shares, plus insights when allowed", async () => {
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/insights")) return ok({ data: [{ name: "post_impressions", values: [{ value: 500 }] }, { name: "post_impressions_unique", values: [{ value: 420 }] }, { name: "post_clicks", values: [{ value: 7 }] }] });
      return ok({ likes: { summary: { total_count: 12 } }, comments: { summary: { total_count: 3 } }, shares: { count: 2 } });
    });
    expect(await facebookMetrics({ token: "T", config: { pageId: "p" } }, "page_1")).toEqual({ likes: 12, comments: 3, shares: 2, impressions: 500, reach: 420, clicks: 7 });
  });

  it("Facebook without read_insights still returns the public numbers", async () => {
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/insights")) return ok({ error: { message: "(#10) permission", code: 10 } }, 400);
      return ok({ likes: { summary: { total_count: 1 } }, comments: { summary: { total_count: 0 } } });
    });
    expect(await facebookMetrics({ token: "T", config: {} }, "x")).toEqual({ likes: 1, comments: 0, shares: undefined });
  });

  it("Instagram: tries the modern metric set, then the old one", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/insights")) {
        asked.push(url.searchParams.get("metric")!);
        if (url.searchParams.get("metric")?.includes("views")) return ok({ error: { message: "(#100) views is not valid for this version" } }, 400);
        return ok({ data: [{ name: "reach", values: [{ value: 900 }] }, { name: "saved", values: [{ value: 11 }] }, { name: "impressions", values: [{ value: 1200 }] }] });
      }
      return ok({ like_count: 40, comments_count: 6 });
    });
    expect(await instagramMetrics({ token: "T", config: {} }, "ig_1")).toEqual({ likes: 40, comments: 6, reach: 900, saves: 11, impressions: 1200, shares: undefined, views: undefined });
    expect(asked).toEqual(["reach,saved,shares,views", "reach,saved,impressions"]);
  });

  it("YouTube: statistics via a fresh access token; Telegram cannot be measured", async () => {
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) return ok({ access_token: "A" });
      return ok({ items: [{ statistics: { viewCount: "1500", likeCount: "30", commentCount: "4" } }] });
    });
    expect(await youtubeMetrics({ token: "refresh", config: {} }, "vid")).toEqual({ views: 1500, likes: 30, comments: 4 });
    expect(await readMetrics("telegram", { token: "T", config: {} }, "42")).toBeNull();
  });
});

describe("analyst run", () => {
  beforeEach(async () => {
    await freshDb();
  });

  async function brandWithResults(name = "Chakravyuh") {
    const { ws } = await makeWorkspace(name);
    const brand = await createBrand(ws.id, { name, platforms: ["instagram"], timezone: "Asia/Kolkata" });
    const campaign = await createCampaign(ws.id, { brandId: brand.id, theme: "Prelims countdown", platforms: ["instagram"], startDate: "2026-10-05", endDate: "2026-10-18", postsPerWeek: 4 });
    await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: campaign.id }, ws.id);
    await processJobs();
    const posts = await listCampaignPosts(ws.id, campaign.id);
    expect(posts).toHaveLength(8);
    const db = await getDb();
    const [channel] = await db.insert(schema.channels).values({ workspaceId: ws.id, brandId: brand.id, platform: "instagram", name: "@chakravyuh", config: { igUserId: "ig" }, secret: encryptSecret("T") }).returning();
    // 4 reels in the evening, 4 image posts at lunch; all published 2-10 days ago.
    for (const [i, p] of posts.entries()) {
      const reel = i < 4;
      await db
        .update(schema.posts)
        .set({ format: reel ? "reel" : "image", scheduledAt: new Date(`2026-10-${String(5 + i).padStart(2, "0")}T${reel ? "14:00" : "07:30"}:00Z`), status: "published" })
        .where(eq(schema.posts.id, p.id));
      await db.insert(schema.publications).values({
        workspaceId: ws.id, postId: p.id, channelId: channel.id, platform: "instagram", version: 1, status: "sent",
        externalId: reel ? `reel_${i}` : `img_${i}`, publishedAt: new Date(Date.now() - (2 + i) * 86400000),
      });
    }
    return { ws, brand, campaign, posts, channel };
  }

  function stubInstagram() {
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input));
      const id = url.pathname.split("/").filter(Boolean).at(-1)?.replace("insights", "") ?? "";
      const reel = url.pathname.includes("reel_");
      if (url.pathname.endsWith("/insights")) return ok({ data: [{ name: "reach", values: [{ value: reel ? 2000 : 300 }] }, { name: "saved", values: [{ value: reel ? 8 : 0 }] }, { name: "views", values: [{ value: reel ? 5000 : 0 }] }] });
      return ok({ like_count: reel ? 60 : 4, comments_count: reel ? 9 : 0, id });
    });
  }

  it("reads results into post_metrics, learns, and writes the learnings into the brand's memory and prompts", async () => {
    const { ws, brand } = await brandWithResults();
    stubInstagram();
    const run = await runAnalyst(ws.id, brand.id);
    expect(run?.read).toBe(8);
    expect(run?.failed).toBe(0);
    const db = await getDb();
    const metrics = await db.select().from(schema.postMetrics).where(eq(schema.postMetrics.brandId, brand.id));
    expect(metrics).toHaveLength(8);
    expect(metrics.every((m) => m.workspaceId === ws.id)).toBe(true);
    const reel = metrics.find((m) => m.likes === 60)!;
    expect(reel).toMatchObject({ comments: 9, reach: 2000, saves: 8, views: 5000, reads: 1 });
    expect(Number(reel.score)).toBe(60 + 18 + 24 + 50);

    const scored = await scoredPosts(ws.id, brand.id);
    expect(scored.filter((p) => p.format === "reel").every((p) => p.time === "19:30")).toBe(true); // 14:00 UTC in IST

    const learnings = run!.learnings;
    expect(learnings.find((l) => l.topic === "format")?.data).toMatchObject({ platform: "instagram", format: "reel" });
    expect(learnings.find((l) => l.topic === "time")?.data).toMatchObject({ platform: "instagram", time: "19:00" });
    const memory = await listMemory(ws.id, brand.id);
    expect(memory.length).toBe(learnings.length);
    expect(memory.every((m) => m.kind === "learning" && m.source === "analyst")).toBe(true);
    const system = await brandSystemPromptWithMemory(brand);
    expect(system).toContain("reels get");
    expect((await brandResults(ws.id, brand.id, 3)).length).toBe(3);
    const [b] = await db.select().from(schema.brands).where(eq(schema.brands.id, brand.id));
    expect(b.analystLastRunAt).not.toBeNull();
  });

  it("re-reads growing numbers without duplicating rows, and a platform error never stops the run", async () => {
    const { ws, brand } = await brandWithResults();
    stubInstagram();
    await runAnalyst(ws.id, brand.id);
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.includes("img_7")) return ok({ error: { message: "Unsupported get request", code: 100 } }, 400);
      if (url.pathname.endsWith("/insights")) return ok({ data: [] });
      return ok({ like_count: 100, comments_count: 1 });
    });
    const run = await runAnalyst(ws.id, brand.id);
    expect(run?.read).toBe(7);
    expect(run?.failed).toBe(1);
    const db = await getDb();
    const metrics = await db.select().from(schema.postMetrics).where(eq(schema.postMetrics.brandId, brand.id));
    expect(metrics).toHaveLength(8);
    expect(metrics.filter((m) => m.reads === 2)).toHaveLength(7);
    expect(metrics.filter((m) => m.likes === 100)).toHaveLength(7);
  });

  it("runs once a day per brand with channels, through the job queue, and only for that brand's workspace", async () => {
    const { ws, brand } = await brandWithResults();
    const { ws: other } = await makeWorkspace("Other");
    await createBrand(other.id, { name: "No channels" }); // nothing to read: never queued
    stubInstagram();
    const t0 = new Date("2026-11-06T03:00:00Z");
    expect(await queueDueAnalysts(t0)).toBe(1);
    expect(await queueDueAnalysts(new Date(t0.getTime() + 3600_000))).toBe(0); // booked for the day
    await processJobs();
    const db = await getDb();
    expect((await db.select().from(schema.postMetrics)).every((m) => m.workspaceId === ws.id && m.brandId === brand.id)).toBe(true);
    expect(await listMemory(other.id, brand.id)).toEqual([]);
    expect(await queueDueAnalysts(new Date(t0.getTime() + 25 * 3600_000))).toBe(1); // next day
  });
});
