import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { clearProviderOverrides, registerProvider } from "@/agent/router";
import { clearImageProviderOverrides, registerImageProvider } from "@/agent/images/router";
import { FakeProvider } from "@/agent/providers/fake";
import { FakeImageProvider } from "@/agent/images/providers";
import { createBrand, createCampaign, getPost, listCampaignPosts, recordPostVersion, reviewPost, updatePost } from "@/lib/data";
import { enqueue, processJobs } from "@/jobs/queue";
import { reviewCount, reviewQueue } from "@/lib/review";
import { freshDb, makeWorkspace } from "./helpers";

function useStubRealProviders() {
  const text = new FakeProvider();
  registerProvider({ name: "gemini", model: "stub-model", generate: (r) => text.generate(r) });
  const img = new FakeImageProvider();
  registerImageProvider({ name: "cloudflare", model: "stub-image", generate: (r) => img.generate(r) });
  vi.stubEnv("AGENT_TEXT_CHAIN", "gemini");
  vi.stubEnv("AGENT_IMAGE_CHAIN", "cloudflare");
}

async function setup(name: string) {
  const { ws, user } = await makeWorkspace(name);
  const brand = await createBrand(ws.id, { name, colors: ["#123456"], platforms: ["instagram"] });
  const campaign = await createCampaign(ws.id, {
    brandId: brand.id,
    theme: "Monsoon offers",
    platforms: ["instagram"],
    startDate: "2026-11-02",
    endDate: "2026-11-15",
    postsPerWeek: 2,
  });
  await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: campaign.id }, ws.id);
  await processJobs();
  const posts = await listCampaignPosts(ws.id, campaign.id);
  return { ws, user, brand, campaign, posts };
}

describe("review queue", () => {
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

  it("lists every ready post with its poster, soonest first, and drops it once decided", async () => {
    const { ws, user, posts } = await setup("Queue");
    const ready = posts.filter((p) => p.status === "drafted");
    expect(ready.length).toBeGreaterThan(1);

    const queue = await reviewQueue(ws.id);
    expect(queue.map((q) => q.post.id).sort()).toEqual(ready.map((p) => p.id).sort());
    expect(await reviewCount(ws.id)).toBe(ready.length);
    expect(queue[0].brandName).toBe("Queue");
    expect(queue[0].campaignTheme).toBe("Monsoon offers");
    expect(queue.every((q) => q.poster?.kind === "poster")).toBe(true);
    const times = queue.map((q) => q.post.scheduledAt?.getTime() ?? Infinity);
    expect(times).toEqual([...times].sort((a, b) => a - b));

    const first = queue[0].post;
    await reviewPost(ws.id, first.id, "approved", null, { userId: user.id, version: first.currentVersion });
    const second = queue[1].post;
    await reviewPost(ws.id, second.id, "rejected", "Shorter please", { userId: user.id, version: second.currentVersion });
    expect(await reviewCount(ws.id)).toBe(ready.length - 2);
    expect((await reviewQueue(ws.id)).some((q) => q.post.id === first.id || q.post.id === second.id)).toBe(false);
  });

  it("brings a post back when it changes after approval, and flags it", async () => {
    const { ws, user, posts } = await setup("Changed");
    const post = posts.find((p) => p.status === "drafted")!;
    await reviewPost(ws.id, post.id, "approved", null, { userId: user.id, version: post.currentVersion });
    expect((await reviewQueue(ws.id)).some((q) => q.post.id === post.id)).toBe(false);

    await updatePost(ws.id, post.id, { caption: "A new caption written by a person.", status: "drafted" });
    await recordPostVersion(ws.id, post.id, "caption", user.id);
    const back = (await reviewQueue(ws.id)).find((q) => q.post.id === post.id);
    expect(back?.previouslyApproved).toBe(post.currentVersion);
    expect(back?.post.currentVersion).toBeGreaterThan(post.currentVersion);
  });

  it("hides demo and busy posts, filters by business, and never shows another workspace", async () => {
    const a = await setup("Alpha");
    const b = await setup("Beta");
    const [demo, busy] = a.posts.filter((p) => p.status === "drafted");
    const db = await getDb();
    await db.update(schema.posts).set({ demoParts: ["text"] }).where(eq(schema.posts.id, demo.id));
    await updatePost(a.ws.id, busy.id, { designStatus: "designing" });

    const ids = (await reviewQueue(a.ws.id)).map((q) => q.post.id);
    expect(ids).not.toContain(demo.id);
    expect(ids).not.toContain(busy.id);
    expect(ids.some((id) => b.posts.some((p) => p.id === id))).toBe(false);

    const other = await createBrand(a.ws.id, { name: "Other", colors: ["#000000"], platforms: ["instagram"] });
    expect(await reviewQueue(a.ws.id, { brandId: other.id })).toEqual([]);
    expect((await reviewQueue(a.ws.id, { brandId: a.brand.id })).length).toBe(ids.length);
    expect((await db.select().from(schema.posts)).length).toBeGreaterThan(ids.length);
    expect((await getPost(a.ws.id, demo.id))?.status).toBe("drafted");
  });
});
