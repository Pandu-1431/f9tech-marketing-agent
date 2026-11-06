import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db";
import { clearProviderOverrides, registerProvider } from "@/agent/router";
import { clearImageProviderOverrides, registerImageProvider } from "@/agent/images/router";
import { FakeProvider } from "@/agent/providers/fake";
import { FakeImageProvider } from "@/agent/images/providers";
import type { TextRequest } from "@/agent/providers/types";
import { listMemory } from "@/agent/memory";
import { exemplarBlock, exemplarLines, listExemplars, pickExemplars } from "@/agent/training/exemplars";
import { changeRatio, editPairForPost } from "@/agent/training/edit-lesson";
import { buildDataset, toJsonl } from "@/agent/training/dataset";
import { createBrand, createCampaign, getBrand, getPost, listCampaignPosts, recordPostVersion, reviewPost, updatePost } from "@/lib/data";
import { enqueue, processJobs } from "@/jobs/queue";
import { freshDb, makeWorkspace } from "./helpers";

const prompts: TextRequest[] = [];

/** Real-provider stand-in (so content is not demo and can be approved) that records prompts. */
function useStubRealProviders() {
  const text = new FakeProvider();
  registerProvider({
    name: "gemini",
    model: "stub-model",
    generate: (r) => {
      prompts.push(r);
      return text.generate(r);
    },
  });
  const img = new FakeImageProvider();
  registerImageProvider({ name: "cloudflare", model: "stub-image", generate: (r) => img.generate(r) });
  vi.stubEnv("AGENT_TEXT_CHAIN", "gemini");
  vi.stubEnv("AGENT_IMAGE_CHAIN", "cloudflare");
}

async function setup(name = "Chakravyuh") {
  const { ws, user } = await makeWorkspace(name);
  const brand = await createBrand(ws.id, { name, colors: ["#123456"], platforms: ["instagram"] });
  const campaign = await createCampaign(ws.id, { brandId: brand.id, theme: "Prelims prep", platforms: ["instagram"], startDate: "2026-11-02", endDate: "2026-11-08", postsPerWeek: 3 });
  await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: campaign.id }, ws.id);
  await processJobs();
  const posts = await listCampaignPosts(ws.id, campaign.id);
  return { ws, user, brand, campaign, posts };
}

async function approve(workspaceId: number, postId: number, userId: number, decision: "approved" | "rejected" = "approved", note: string | null = null) {
  const post = (await getPost(workspaceId, postId))!;
  return reviewPost(workspaceId, postId, decision, note, { userId, version: post.currentVersion });
}

/** What a person does in the editor: change the caption, save a version. */
async function humanEdit(workspaceId: number, postId: number, userId: number, caption: string) {
  await updatePost(workspaceId, postId, { caption, status: "drafted" });
  await recordPostVersion(workspaceId, postId, "caption", userId);
}

describe("training: exemplars, edit lessons, dataset", () => {
  beforeEach(async () => {
    prompts.length = 0;
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

  it("measures how much a caption changed", () => {
    expect(changeRatio("a b c", "a b c")).toBe(0);
    expect(changeRatio("a b c", "x y z")).toBe(1);
    expect(changeRatio("one two three four", "one two three five")).toBeCloseTo(0.25);
  });

  it("ranks examples: measured winners, then edited, then approved; same platform first", () => {
    const base = { format: "image", hashtags: [], posterHeadline: null };
    const all = [
      { ...base, postId: 1, platform: "instagram", caption: "approved one", why: "approved" as const, score: null },
      { ...base, postId: 2, platform: "facebook", caption: "measured fb", why: "measured" as const, score: 50 },
      { ...base, postId: 3, platform: "instagram", caption: "edited ig", why: "edited" as const, score: null },
    ];
    expect(pickExemplars(all, ["instagram"], 2).map((e) => e.postId)).toEqual([1, 3]);
    expect(exemplarBlock([])).toEqual([]);
    expect(exemplarBlock(all).join("\n")).toContain("EXAMPLES OF THIS BRAND'S POSTS THAT WORKED");
  });

  it("feeds approved posts back to the copywriter as examples, per brand only", async () => {
    const { ws, user, brand, campaign, posts } = await setup();
    const { ws: other } = await makeWorkspace("Other");
    const otherBrand = await createBrand(other.id, { name: "Other", platforms: ["instagram"] });
    await humanEdit(ws.id, posts[0].id, user.id, "Short, warm caption a person wrote for the Prelims plan. Start today, one hour a day.");
    await approve(ws.id, posts[0].id, user.id);

    const ex = await listExemplars(ws.id, brand.id);
    expect(ex.map((e) => e.postId)).toEqual([posts[0].id]);
    expect(ex[0].why).toBe("edited");
    expect(await listExemplars(other.id, otherBrand.id)).toEqual([]);
    expect(await listExemplars(other.id, brand.id)).toEqual([]); // wrong workspace

    // A rewrite now carries the example in its prompt.
    prompts.length = 0;
    await updatePost(ws.id, posts[1].id, { status: "idea" });
    await enqueue("post.rewrite", { workspaceId: ws.id, postId: posts[1].id }, ws.id);
    await processJobs();
    const copy = prompts.find((p) => p.prompt.includes("TASK: POST_COPY"));
    expect(copy?.prompt).toContain("Short, warm caption a person wrote");
    expect((await exemplarLines(ws.id, brand.id, campaign.platforms)).length).toBeGreaterThan(0);
  });

  it("learns a rule from a person's edit when the post is approved", async () => {
    const { ws, user, brand, posts } = await setup();
    const post = posts[0];
    await humanEdit(ws.id, post.id, user.id, "Prelims in 199 days. Start now.");
    await approve(ws.id, post.id, user.id);

    const pair = await editPairForPost(ws.id, post.id);
    expect(pair?.after).toBe("Prelims in 199 days. Start now.");
    expect(pair?.before).not.toBe(pair?.after);

    await processJobs(); // post.learn_edit
    const rules = (await listMemory(ws.id, brand.id)).filter((m) => m.source === "editor");
    expect(rules.map((r) => r.text)).toEqual(["Keep captions short and get to the point in the first line."]);
    expect(prompts.some((p) => p.prompt.includes("TASK: EDIT_LESSON"))).toBe(true);
  });

  it("does not learn from approvals without an edit, or from tiny edits", async () => {
    const { ws, user, brand, posts } = await setup();
    await approve(ws.id, posts[0].id, user.id);
    const original = (await getPost(ws.id, posts[1].id))!.caption!;
    await humanEdit(ws.id, posts[1].id, user.id, original + " Yes.");
    await approve(ws.id, posts[1].id, user.id);
    await processJobs();
    expect(await editPairForPost(ws.id, posts[0].id)).toBeNull();
    expect(await editPairForPost(ws.id, posts[1].id)).toBeNull();
    expect((await listMemory(ws.id, brand.id)).filter((m) => m.source === "editor")).toEqual([]);
  });

  it("builds SFT examples and DPO pairs from approvals, edits and rejections", async () => {
    const { ws, user, brand, posts } = await setup();
    // Post 0: edited, then approved -> 1 SFT + 1 DPO (edit beats draft).
    await humanEdit(ws.id, posts[0].id, user.id, "Prelims in 199 days. Start now.");
    await approve(ws.id, posts[0].id, user.id);
    // Post 1: rejected, edited, approved -> 1 SFT + edit pair + rejection pair.
    await approve(ws.id, posts[1].id, user.id, "rejected", "Too long");
    await humanEdit(ws.id, posts[1].id, user.id, "One hour a day is enough. Here is how.");
    await approve(ws.id, posts[1].id, user.id);
    // Post 2: approved as written -> 1 SFT only.
    await approve(ws.id, posts[2].id, user.id);

    const fresh = (await getBrand(ws.id, brand.id))!;
    const data = await buildDataset(ws.id, fresh);
    expect(data.stats).toMatchObject({ approved: 3, sft: 3, edited: 2, rejectedThenApproved: 1, dpo: 3 });
    const row = data.sft[0];
    expect(row.messages.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
    expect(row.messages[1].content).toContain("TASK: POST_COPY");
    expect(JSON.parse(row.messages[2].content).caption).toBe("Prelims in 199 days. Start now.");
    expect(JSON.parse(data.dpo[0].preferred_output[0].content).caption).toBe("Prelims in 199 days. Start now.");

    const lines = toJsonl(data.sft).trim().split("\n");
    expect(lines).toHaveLength(3);
    lines.forEach((l) => expect(() => JSON.parse(l)).not.toThrow());

    // Another workspace sees nothing.
    const { ws: other } = await makeWorkspace("Other");
    expect((await buildDataset(other.id, fresh)).stats.sft).toBe(0);
    const db = await getDb();
    expect((await db.select().from(schema.approvals)).length).toBeGreaterThan(0);
  });
});
