import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { clearProviderOverrides, registerProvider } from "@/agent/router";
import { clearImageProviderOverrides, registerImageProvider } from "@/agent/images/router";
import { FakeProvider } from "@/agent/providers/fake";
import { FakeImageProvider } from "@/agent/images/providers";
import {
  BusyPostError,
  createBrand,
  createCampaign,
  getPost,
  isApprovedForPublish,
  listCampaignPosts,
  postHistory,
  recordPostVersion,
  reviewPost,
  StaleVersionError,
  updatePost,
} from "@/lib/data";
import { enqueue, processJobs } from "@/jobs/queue";
import { freshDb, makeWorkspace } from "./helpers";

/** Real-provider stand-ins, so the content is not demo and can be approved. */
function useStubRealProviders() {
  const text = new FakeProvider();
  registerProvider({ name: "gemini", model: "stub-model", generate: (r) => text.generate(r) });
  const img = new FakeImageProvider();
  registerImageProvider({ name: "cloudflare", model: "stub-image", generate: (r) => img.generate(r) });
  vi.stubEnv("AGENT_TEXT_CHAIN", "gemini");
  vi.stubEnv("AGENT_IMAGE_CHAIN", "cloudflare");
}

async function runCampaign(name: string) {
  const { ws, user } = await makeWorkspace(name);
  const brand = await createBrand(ws.id, { name, colors: ["#123456"], platforms: ["instagram"] });
  const campaign = await createCampaign(ws.id, {
    brandId: brand.id,
    theme: "Monsoon offers",
    platforms: ["instagram"],
    startDate: "2026-11-02",
    endDate: "2026-11-04",
    postsPerWeek: 2,
  });
  await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: campaign.id }, ws.id);
  await processJobs();
  const [post] = await listCampaignPosts(ws.id, campaign.id);
  return { ws, user, post: (await getPost(ws.id, post.id))! };
}

async function approve(workspaceId: number, postId: number, userId: number) {
  const post = (await getPost(workspaceId, postId))!;
  return reviewPost(workspaceId, postId, "approved", null, { userId, version: post.currentVersion });
}

describe("approval versioning and lock", () => {
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

  it("the agent's caption and poster are saved as versions", async () => {
    const { ws, post } = await runCampaign("Versions Co");
    const { versions } = await postHistory(ws.id, post.id);
    expect(post.currentVersion).toBeGreaterThanOrEqual(2);
    expect(versions[0].version).toBe(post.currentVersion);
    expect(versions.map((v) => v.reason)).toEqual(expect.arrayContaining(["ai_write", "poster"]));
    expect(versions[0].posterAssetId).not.toBeNull();
    expect(versions[0].caption).toBe(post.caption);
  });

  it("approval records who approved which version, and the post is ready to publish", async () => {
    const { ws, user, post } = await runCampaign("Approve Co");
    await approve(ws.id, post.id, user.id);
    const fresh = (await getPost(ws.id, post.id))!;
    expect(fresh.status).toBe("approved");
    expect(fresh.approvedVersion).toBe(post.currentVersion);
    expect(isApprovedForPublish(fresh)).toBe(true);
    const { reviews } = await postHistory(ws.id, post.id);
    expect(reviews[0]).toMatchObject({ decision: "approved", version: post.currentVersion, userId: user.id, byName: "Approve Co" });
  });

  it("changing the poster after approval sends the post back to review (the audit bug)", async () => {
    const { ws, user, post } = await runCampaign("Poster Co");
    await approve(ws.id, post.id, user.id);
    const approvedVersion = (await getPost(ws.id, post.id))!.currentVersion;

    await updatePost(ws.id, post.id, { posterHeadline: "New headline", designStatus: "designing" });
    await enqueue("post.design", { workspaceId: ws.id, postId: post.id }, ws.id);
    await processJobs();

    const fresh = (await getPost(ws.id, post.id))!;
    expect(fresh.status).toBe("drafted");
    expect(fresh.currentVersion).toBe(approvedVersion + 1);
    expect(fresh.approvedVersion).toBe(approvedVersion); // history kept
    expect(isApprovedForPublish(fresh)).toBe(false);
    // The approved version still points at the poster that was approved.
    const { versions } = await postHistory(ws.id, post.id);
    const approvedSnap = versions.find((v) => v.version === approvedVersion)!;
    const newSnap = versions.find((v) => v.version === approvedVersion + 1)!;
    expect(newSnap.posterAssetId).not.toBe(approvedSnap.posterAssetId);
    expect(newSnap.posterHeadline).toBe("New headline");
  });

  it("editing the caption after approval sends the post back to review", async () => {
    const { ws, user, post } = await runCampaign("Caption Co");
    await approve(ws.id, post.id, user.id);
    await updatePost(ws.id, post.id, { caption: "Edited by hand" });
    await recordPostVersion(ws.id, post.id, "caption", user.id);
    const fresh = (await getPost(ws.id, post.id))!;
    expect(fresh.status).toBe("drafted");
    const { versions } = await postHistory(ws.id, post.id);
    expect(versions[0]).toMatchObject({ reason: "caption", caption: "Edited by hand", createdBy: user.id });
  });

  it("approving a version that is no longer the latest is refused", async () => {
    const { ws, user, post } = await runCampaign("Stale Co");
    const seen = post.currentVersion;
    await recordPostVersion(ws.id, post.id, "caption", user.id); // someone changed it meanwhile
    await expect(reviewPost(ws.id, post.id, "approved", null, { userId: user.id, version: seen })).rejects.toBeInstanceOf(
      StaleVersionError,
    );
    expect((await getPost(ws.id, post.id))!.status).toBe("drafted");
    expect((await postHistory(ws.id, post.id)).reviews).toEqual([]);
  });

  it("approval is refused while the poster is still being made", async () => {
    const { ws, user, post } = await runCampaign("Busy Co");
    await updatePost(ws.id, post.id, { designStatus: "designing" });
    await expect(approve(ws.id, post.id, user.id)).rejects.toBeInstanceOf(BusyPostError);
  });

  it("rejecting is logged too, and a re-approval after changes works", async () => {
    const { ws, user, post } = await runCampaign("Loop Co");
    await reviewPost(ws.id, post.id, "rejected", "Too long", { userId: user.id, version: post.currentVersion });
    expect((await getPost(ws.id, post.id))!.status).toBe("rejected");
    await updatePost(ws.id, post.id, { caption: "Shorter" });
    await recordPostVersion(ws.id, post.id, "caption", user.id);
    expect((await getPost(ws.id, post.id))!.status).toBe("drafted");
    await approve(ws.id, post.id, user.id);
    const fresh = (await getPost(ws.id, post.id))!;
    expect(isApprovedForPublish(fresh)).toBe(true);
    const { reviews } = await postHistory(ws.id, post.id);
    expect(reviews.map((r) => r.decision)).toEqual(["approved", "rejected"]);
  });

  it("another workspace cannot version, approve or read the history of a post", async () => {
    const { ws, post } = await runCampaign("Owner Co");
    const { ws: other, user: stranger } = await makeWorkspace("Other Co");
    expect(await recordPostVersion(other.id, post.id, "caption", stranger.id)).toBeNull();
    expect(await reviewPost(other.id, post.id, "approved", null, { userId: stranger.id, version: post.currentVersion })).toBeNull();
    const history = await postHistory(other.id, post.id);
    expect(history.versions).toEqual([]);
    expect(history.reviews).toEqual([]);
    const db = await getDb();
    const [row] = await db.select().from(schema.posts).where(eq(schema.posts.id, post.id));
    expect(row.currentVersion).toBe(post.currentVersion);
    expect(row.status).toBe("drafted");
    void ws;
  });
});
