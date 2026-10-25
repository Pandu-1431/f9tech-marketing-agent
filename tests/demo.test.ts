import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { clearProviderOverrides, registerProvider } from "@/agent/router";
import { clearImageProviderOverrides, registerImageProvider } from "@/agent/images/router";
import { FakeProvider } from "@/agent/providers/fake";
import { FakeImageProvider } from "@/agent/images/providers";
import { createBrand, createCampaign, DemoContentError, getPost, listCampaignPosts, reviewPost, setDemoPart } from "@/lib/data";
import { enqueue, processJobs } from "@/jobs/queue";
import { freshDb, makeWorkspace } from "./helpers";

/** Stand-ins for REAL providers: same output as the demo generator, but a real provider name. */
function useStubRealProviders() {
  const text = new FakeProvider();
  registerProvider({ name: "gemini", model: "stub-model", generate: (r) => text.generate(r) });
  const img = new FakeImageProvider();
  registerImageProvider({ name: "cloudflare", model: "stub-image", generate: (r) => img.generate(r) });
  vi.stubEnv("AGENT_TEXT_CHAIN", "gemini");
  vi.stubEnv("AGENT_IMAGE_CHAIN", "cloudflare");
}

async function runCampaign(name: string, format?: "reel") {
  const { ws } = await makeWorkspace(name);
  const brand = await createBrand(ws.id, { name, colors: ["#123456"], platforms: ["instagram"] });
  const campaign = await createCampaign(ws.id, {
    brandId: brand.id,
    theme: "Cloud migration for IT teams",
    platforms: ["instagram"],
    startDate: "2026-11-02",
    endDate: "2026-11-04",
    postsPerWeek: 2,
  });
  await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: campaign.id }, ws.id);
  await processJobs();
  if (format === "reel") {
    const [post] = await listCampaignPosts(ws.id, campaign.id);
    await enqueue("post.reel", { workspaceId: ws.id, postId: post.id }, ws.id);
    await processJobs();
  }
  return { ws, posts: await listCampaignPosts(ws.id, campaign.id) };
}

async function latestAsset(workspaceId: number, postId: number, kind: string) {
  const db = await getDb();
  const [a] = await db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.workspaceId, workspaceId), eq(schema.assets.postId, postId), eq(schema.assets.kind, kind)))
    .orderBy(desc(schema.assets.id))
    .limit(1);
  return a;
}

describe("demo content labels", () => {
  beforeEach(async () => {
    await freshDb();
    clearProviderOverrides();
    clearImageProviderOverrides();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    clearProviderOverrides();
    clearImageProviderOverrides();
  });

  it("marks posts and posters made by the demo generator, and refuses to approve them", async () => {
    const { ws, posts } = await runCampaign("Demo Co");
    expect(posts.length).toBeGreaterThan(0);
    for (const p of posts) {
      expect(p.demoParts.sort()).toEqual(["image", "text"]);
      expect((await latestAsset(ws.id, p.id, "poster")).demo).toBe(true);
      expect((await latestAsset(ws.id, p.id, "background")).demo).toBe(true);
    }
    const target = posts[0];
    await expect(reviewPost(ws.id, target.id, "approved", null)).rejects.toBeInstanceOf(DemoContentError);
    expect((await getPost(ws.id, target.id))?.status).toBe("drafted");
    // Rejecting demo content is still allowed.
    await reviewPost(ws.id, target.id, "rejected", "demo");
    expect((await getPost(ws.id, target.id))?.status).toBe("rejected");
  });

  it("real providers produce unlabelled content that can be approved", async () => {
    useStubRealProviders();
    const { ws, posts } = await runCampaign("Real Co");
    for (const p of posts) {
      expect(p.demoParts).toEqual([]);
      expect((await latestAsset(ws.id, p.id, "poster")).demo).toBe(false);
    }
    await reviewPost(ws.id, posts[0].id, "approved", null);
    expect((await getPost(ws.id, posts[0].id))?.status).toBe("approved");
  });

  it("demo markers are added and removed without touching the others", async () => {
    useStubRealProviders();
    const { ws, posts } = await runCampaign("Marker Co");
    const id = posts[0].id;
    await setDemoPart(ws.id, id, "image", true);
    await setDemoPart(ws.id, id, "image", true); // no duplicate
    await setDemoPart(ws.id, id, "text", true);
    expect((await getPost(ws.id, id))?.demoParts.sort()).toEqual(["image", "text"]);
    await setDemoPart(ws.id, id, "text", false); // e.g. a person edited the caption
    expect((await getPost(ws.id, id))?.demoParts).toEqual(["image"]);
    await expect(reviewPost(ws.id, id, "approved", null)).rejects.toBeInstanceOf(DemoContentError);
  });

  it("a demo marker in one workspace cannot be set from another", async () => {
    useStubRealProviders();
    const { posts } = await runCampaign("Owner Co");
    const { ws: other } = await makeWorkspace("Other Co");
    await setDemoPart(other.id, posts[0].id, "image", true);
    const db = await getDb();
    const [row] = await db.select().from(schema.posts).where(eq(schema.posts.id, posts[0].id));
    expect(row.demoParts).toEqual([]);
    expect(await reviewPost(other.id, posts[0].id, "approved", null)).toBeNull();
  });

  it("a reel made from demo images is labelled", async () => {
    const { ws, posts } = await runCampaign("Reel Co", "reel");
    const post = await getPost(ws.id, posts[0].id);
    expect(post?.reelStatus).toBe("done");
    expect(post?.demoParts).toContain("video");
    expect((await latestAsset(ws.id, posts[0].id, "video")).demo).toBe(true);
  });
});
