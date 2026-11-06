import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { bestFormats, bestTimes, forget, listMemory, memoryBlock, memoryLines, remember, rememberFeedback, replaceLearnings } from "@/agent/memory";
import { brandSystemPromptWithMemory } from "@/agent/brand-context";
import { plannerPrompt } from "@/agent/planner";
import { getDb, schema } from "@/db";
import { processJobs, enqueue } from "@/jobs/queue";
import { createBrand, createCampaign, getBrand, listCampaignPosts, recordPostVersion, reviewPost, updatePost } from "@/lib/data";
import { freshDb, makeWorkspace } from "./helpers";

describe("brand memory", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("remembers lines per brand and never shows one brand's memory to another workspace", async () => {
    const { ws } = await makeWorkspace("A");
    const { ws: other } = await makeWorkspace("B");
    const a = await createBrand(ws.id, { name: "Chakravyuh" });
    const b = await createBrand(other.id, { name: "Vizag Sweets" });
    await remember(ws.id, a.id, { kind: "fact", text: "Students study late at night; evening posts work." });
    await remember(other.id, b.id, { kind: "fact", text: "Festival boxes sell out early." });

    expect((await listMemory(ws.id, a.id)).map((m) => m.text)).toEqual(["Students study late at night; evening posts work."]);
    expect(await listMemory(ws.id, b.id)).toEqual([]); // wrong workspace for brand b
    expect((await memoryLines(ws.id, a.id)).join("\n")).toContain("Students study late");
    expect((await memoryLines(ws.id, a.id)).join("\n")).not.toContain("Festival boxes");
  });

  it("puts the memory into every agent's system prompt, and nothing when the brand has learned nothing", async () => {
    const { ws } = await makeWorkspace("A");
    const brand = await createBrand(ws.id, { name: "Chakravyuh" });
    const empty = await brandSystemPromptWithMemory(brand);
    expect(empty).not.toContain("BRAND MEMORY");

    await remember(ws.id, brand.id, { kind: "learning", topic: "format", text: "On instagram, reels get 2.4x the engagement (8 posts).", data: { platform: "instagram", format: "reel" }, weight: 8 });
    await rememberFeedback(ws.id, brand.id, "Never mention the price of the paid plan.");
    const system = await brandSystemPromptWithMemory(brand);
    expect(system).toContain("BRAND MEMORY");
    expect(system).toContain("Rules from the reviewer");
    expect(system).toContain("- Never mention the price of the paid plan.");
    expect(system).toContain("What the results show");
    expect(system).toContain("reels get 2.4x");
  });

  it("turns a reviewer's rejection note into a standing rule (once, weighted when repeated)", async () => {
    const { ws, user } = await makeWorkspace("A");
    const brand = await createBrand(ws.id, { name: "Chakravyuh", platforms: ["instagram"] });
    const campaign = await createCampaign(ws.id, { brandId: brand.id, theme: "Prelims", platforms: ["instagram"], startDate: "2026-11-09", endDate: "2026-11-10", postsPerWeek: 1 });
    await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: campaign.id }, ws.id);
    await processJobs();
    const [post] = await listCampaignPosts(ws.id, campaign.id);
    const fresh = (await listCampaignPosts(ws.id, campaign.id))[0];
    await reviewPost(ws.id, post.id, "rejected", "Too formal. Write like a friend.", { userId: user.id, version: fresh.currentVersion });
    let rules = (await listMemory(ws.id, brand.id)).filter((m) => m.kind === "feedback");
    expect(rules.map((r) => r.text)).toEqual(["Too formal. Write like a friend."]);
    expect(rules[0].source).toBe("reviewer");

    // Same note again on a later version: one rule, more weight.
    await updatePost(ws.id, post.id, { caption: "edited" });
    await recordPostVersion(ws.id, post.id, "caption");
    const again = (await listCampaignPosts(ws.id, campaign.id))[0];
    await reviewPost(ws.id, post.id, "rejected", "too formal. write like a friend.", { userId: user.id, version: again.currentVersion });
    rules = (await listMemory(ws.id, brand.id)).filter((m) => m.kind === "feedback");
    expect(rules).toHaveLength(1);
    expect(rules[0].weight).toBe(2);

    // An empty note is not a rule.
    await updatePost(ws.id, post.id, { caption: "edited twice" });
    await recordPostVersion(ws.id, post.id, "caption");
    const third = (await listCampaignPosts(ws.id, campaign.id))[0];
    await reviewPost(ws.id, post.id, "rejected", "  ", { userId: user.id, version: third.currentVersion });
    expect((await listMemory(ws.id, brand.id)).filter((m) => m.kind === "feedback")).toHaveLength(1);
  });

  it("replaces the Analyst's learnings as a set and keeps the old ones inactive for history", async () => {
    const { ws } = await makeWorkspace("A");
    const brand = await createBrand(ws.id, { name: "Chakravyuh" });
    await replaceLearnings(ws.id, brand.id, [{ topic: "time", text: "Evening is best on instagram.", data: { platform: "instagram", time: "19:00" }, weight: 5 }]);
    await replaceLearnings(ws.id, brand.id, [
      { topic: "time", text: "Night is best on instagram.", data: { platform: "instagram", time: "21:00" }, weight: 9 },
      { topic: "format", text: "Reels win on instagram.", data: { platform: "instagram", format: "reel" }, weight: 6 },
    ]);
    const active = await listMemory(ws.id, brand.id);
    expect(active.map((m) => m.text)).toEqual(["Night is best on instagram.", "Reels win on instagram."]); // strongest first
    expect(await listMemory(ws.id, brand.id, { all: true })).toHaveLength(3);
    expect(bestTimes(active)).toEqual({ instagram: "21:00" });
    expect(bestFormats(active)).toEqual({ instagram: "reel" });

    await forget(ws.id, active[1].id);
    expect(bestFormats(await listMemory(ws.id, brand.id))).toEqual({});
  });

  it("the planner uses the best hour the Analyst found when the model gives no time", async () => {
    const { ws } = await makeWorkspace("A");
    const brand = await createBrand(ws.id, { name: "Chakravyuh", platforms: ["instagram"], timezone: "Asia/Kolkata" });
    await replaceLearnings(ws.id, brand.id, [{ topic: "time", text: "Night is best on instagram.", data: { platform: "instagram", time: "21:00" }, weight: 9 }]);
    const campaign = await createCampaign(ws.id, { brandId: brand.id, theme: "Prelims", platforms: ["instagram"], startDate: "2026-11-09", endDate: "2026-11-10", postsPerWeek: 2 });
    await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: campaign.id }, ws.id);
    await processJobs();
    const posts = await listCampaignPosts(ws.id, campaign.id);
    expect(posts.length).toBeGreaterThan(0);
    // 21:00 IST = 15:30 UTC
    for (const p of posts) expect(p.scheduledAt?.toISOString().slice(11, 16)).toBe("15:30");
    const prompt = plannerPrompt(campaign, 2, brand, { times: { instagram: "21:00" }, formats: { instagram: "reel" } });
    expect(prompt).toContain("BEST POSTING TIMES");
    expect(prompt).toContain("instagram 21:00");
    expect(prompt).toContain("instagram = reel");
  });

  it("memoryBlock keeps prompts short", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ kind: "learning" as const, text: `learning ${i}`, weight: 1 }));
    const lines = memoryBlock(rows);
    expect(lines.filter((l) => l.startsWith("- ")).length).toBeLessThanOrEqual(14);
    expect(memoryBlock([])).toEqual([]);
  });

  it("cascades with the brand", async () => {
    const { ws } = await makeWorkspace("A");
    const brand = await createBrand(ws.id, { name: "Gone" });
    await remember(ws.id, brand.id, { kind: "fact", text: "x" });
    const db = await getDb();
    await db.delete(schema.brands).where(eq(schema.brands.id, brand.id));
    expect(await getBrand(ws.id, brand.id)).toBeNull();
    expect(await db.select().from(schema.memory)).toEqual([]);
  });
});
