import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { enqueue, kickWorker, processJobs } from "@/jobs/queue";
import { handlers } from "@/jobs/handlers";
import { createBrand, createCampaign, getCampaign, listCampaignPosts } from "@/lib/data";
import { pipelinePosters } from "@/lib/concurrency";
import { freshDb, makeWorkspace } from "./helpers";

/*
 * Speed: posters start as soon as each batch of captions is written (pipelined), instead of
 * every poster waiting for the last caption. With 3 job lanes, writing and designing overlap.
 */
describe("pipelined posters", () => {
  beforeEach(async () => {
    await freshDb();
  });
  afterEach(() => vi.unstubAllEnvs());

  async function campaign() {
    const { ws } = await makeWorkspace("Speed Co");
    const brand = await createBrand(ws.id, { name: "Speed Co", platforms: ["instagram"], colors: ["#3730a3"] });
    const c = await createCampaign(ws.id, { brandId: brand.id, theme: "Diwali", platforms: ["instagram"], startDate: "2026-11-01", endDate: "2026-11-07", postsPerWeek: 4, formats: ["image", "reel"] });
    await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: c.id }, ws.id);
    return { ws, brand, c };
  }

  it("queues one poster job per post the moment it is written, then the campaign job only does the leftovers", async () => {
    expect(pipelinePosters()).toBe(true);
    const { ws, c } = await campaign();
    const db = await getDb();
    // Run the plan job and the write job by hand, then look at the queue before anything else runs.
    await processJobs(1); // campaign.plan
    await processJobs(1); // campaign.write
    const posts = await listCampaignPosts(ws.id, c.id);
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((p) => p.status === "drafted" && p.designStatus === "designing")).toBe(true);
    const queued = await db.select().from(schema.jobs).where(and(eq(schema.jobs.workspaceId, ws.id), eq(schema.jobs.status, "queued")));
    const designJobs = queued.filter((j) => j.type === "post.design");
    expect(designJobs.map((j) => Number(j.payload.postId)).sort()).toEqual(posts.map((p) => p.id).sort());
    expect(designJobs.every((j) => j.payload.thenReel === true)).toBe(true);
    const campaignDesign = queued.find((j) => j.type === "campaign.design");
    expect(campaignDesign).toBeTruthy();
    // The poster jobs were queued BEFORE the campaign-level design job (they start first).
    expect(Math.max(...designJobs.map((j) => j.id))).toBeLessThan(campaignDesign!.id);

    // Everything still finishes: every poster done, every reel made, no post done twice.
    await processJobs();
    const done = await listCampaignPosts(ws.id, c.id);
    expect(done.every((p) => p.designStatus === "done")).toBe(true);
    expect(done.filter((p) => p.format === "reel").every((p) => p.reelStatus === "done")).toBe(true);
    const reelJobs = await db.select().from(schema.jobs).where(and(eq(schema.jobs.workspaceId, ws.id), eq(schema.jobs.type, "post.reel")));
    expect(reelJobs.length).toBe(done.filter((p) => p.format === "reel").length); // one reel job per reel post
    expect((await getCampaign(ws.id, c.id))?.status).toBe("ready");
    const posters = await db.select().from(schema.assets).where(and(eq(schema.assets.workspaceId, ws.id), eq(schema.assets.kind, "poster"), inArray(schema.assets.postId, done.map((p) => p.id))));
    expect(posters.length).toBeGreaterThanOrEqual(done.length); // every post got its poster
  });

  it("AGENT_PIPELINE=false keeps the old two-wave order (write everything, then design everything)", async () => {
    vi.stubEnv("AGENT_PIPELINE", "false");
    expect(pipelinePosters()).toBe(false);
    const { ws, c } = await campaign();
    await processJobs(2);
    const db = await getDb();
    const queued = await db.select().from(schema.jobs).where(and(eq(schema.jobs.workspaceId, ws.id), eq(schema.jobs.status, "queued")));
    expect(queued.map((j) => j.type)).toEqual(["campaign.design"]);
    await processJobs();
    expect((await listCampaignPosts(ws.id, c.id)).every((p) => p.designStatus === "done")).toBe(true);
  });

  it("the campaign design job leaves posts whose own poster job is running alone", async () => {
    const { ws, c } = await campaign();
    await processJobs(2);
    const db = await getDb();
    // Pretend one poster job is still running in another lane: the campaign job must not redo it.
    const [queuedDesign] = await db.select().from(schema.jobs).where(and(eq(schema.jobs.workspaceId, ws.id), eq(schema.jobs.type, "post.design")));
    await db.update(schema.jobs).set({ status: "running" }).where(eq(schema.jobs.id, queuedDesign.id));
    await handlers["campaign.design"]({ workspaceId: ws.id, campaignId: c.id });
    const post = (await listCampaignPosts(ws.id, c.id)).find((p) => p.id === Number(queuedDesign.payload.postId))!;
    expect(post.designStatus).toBe("designing");
    const posters = await db.select().from(schema.assets).where(and(eq(schema.assets.postId, post.id), eq(schema.assets.kind, "poster")));
    expect(posters).toHaveLength(0);
  });

  it("kickWorker is a no-op until the inline worker is running (tests and scripts drive the queue themselves)", async () => {
    const g = globalThis as unknown as { __agentWorker?: boolean; __agentLanes?: number };
    expect(g.__agentWorker).toBeFalsy();
    kickWorker();
    await new Promise((r) => setImmediate(r));
    expect(g.__agentLanes ?? 0).toBe(0);
  });
});
