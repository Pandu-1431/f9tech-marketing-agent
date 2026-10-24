import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrand, createCampaign, getCampaign, listCampaignPosts } from "@/lib/data";
import { campaignJobProblem, enqueue, processJobs } from "@/jobs/queue";
import { clearProviderOverrides } from "@/agent/router";
import { FakeProvider } from "@/agent/providers/fake";
import { freshDb, makeWorkspace } from "./helpers";

// Google's exact answer for a retired model (copied from the real error).
const RETIRED_404 = (model: string) =>
  JSON.stringify({
    error: {
      code: 404,
      message: `This model models/${model} is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features and improvements. We recommend you to use the Interactions API (https://ai.google.dev/gemini-api/docs/get-started).`,
      status: "NOT_FOUND",
    },
  });

/**
 * Pretend to be Google as seen with a real free key (Oct 2026):
 * 2.5-flash retired (404), 3.8-flash / flash-latest overloaded (503) or over quota (429),
 * flash-lite-latest answers.
 */
function fakeGoogle(calls: string[]) {
  const brain = new FakeProvider();
  return vi.fn(async (url: string, init: RequestInit) => {
    const model = decodeURIComponent(url.split("/models/")[1].split(":")[0]);
    calls.push(model);
    if (model === "gemini-2.5-flash") return new Response(RETIRED_404(model), { status: 404 });
    if (model === "gemini-3.8-flash") return new Response('{"error":{"code":429,"message":"You exceeded your current quota"}}', { status: 429 });
    if (model === "gemini-flash-latest") return new Response('{"error":{"code":503,"message":"This model is currently experiencing high demand."}}', { status: 503 });
    if (model !== "gemini-flash-lite-latest") return new Response(RETIRED_404(model), { status: 404 });
    const body = JSON.parse(String(init.body));
    const out = await brain.generate({
      system: body.systemInstruction.parts[0].text,
      prompt: body.contents[0].parts[0].text,
      json: body.generationConfig.responseMimeType === "application/json",
    });
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: out.text }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 } }),
      { status: 200 },
    );
  });
}

describe("real-world setup: GEMINI_MODEL=gemini-2.5-flash (retired by Google)", () => {
  beforeEach(async () => {
    await freshDb();
    clearProviderOverrides();
    (await import("@/agent/providers/gemini")).resetGeminiState();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("a Diwali campaign still plans and writes every post", async () => {
    vi.stubEnv("AGENT_TEXT_CHAIN", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_MODEL", "gemini-2.5-flash");
    const calls: string[] = [];
    vi.stubGlobal("fetch", fakeGoogle(calls));

    const { ws } = await makeWorkspace("VizagVolunteers");
    const brand = await createBrand(ws.id, { name: "VizagVolunteers", city: "Visakhapatnam", platforms: ["instagram", "facebook"] });
    const campaign = await createCampaign(ws.id, {
      brandId: brand.id,
      theme: "Diwali donation drive for orphanage children",
      goal: "Raise donations",
      platforms: ["instagram", "facebook"],
      startDate: "2026-11-01",
      endDate: "2026-11-07",
      postsPerWeek: 3,
    });
    await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: campaign.id }, ws.id);
    await processJobs();

    const done = await getCampaign(ws.id, campaign.id);
    expect(done?.error ?? null).toBeNull();
    expect(done?.status).toBe("ready");
    const posts = await listCampaignPosts(ws.id, campaign.id);
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((p) => p.status === "drafted" && p.caption)).toBe(true);
    expect(calls).not.toContain("gemini-2.5-flash"); // never wastes a call on the retired model
    expect(new Set(calls)).toEqual(new Set(["gemini-flash-lite-latest"])); // fast model, no wasted calls
    expect(await campaignJobProblem(ws.id, campaign.id)).toBeNull();
  });

  it("when the user lists the busy models first, it still finishes using the one that works", async () => {
    vi.stubEnv("AGENT_TEXT_CHAIN", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_MODEL", "gemini-3.8-flash,gemini-flash-latest");
    const calls: string[] = [];
    vi.stubGlobal("fetch", fakeGoogle(calls));
    const { ws } = await makeWorkspace("Busy Co");
    const brand = await createBrand(ws.id, { name: "Busy Co", platforms: ["instagram"] });
    const campaign = await createCampaign(ws.id, {
      brandId: brand.id, theme: "Diwali", platforms: ["instagram"], startDate: "2026-11-01", endDate: "2026-11-07", postsPerWeek: 4,
    });
    await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: campaign.id }, ws.id);
    await processJobs();
    expect((await getCampaign(ws.id, campaign.id))?.status).toBe("ready");
    // Busy models are tried once, then rested; the rest of the work goes to the lite model.
    expect(calls.filter((m) => m === "gemini-3.8-flash")).toHaveLength(1);
    expect(calls.filter((m) => m === "gemini-flash-latest")).toHaveLength(1);
  });

  it("after Retry, the old error message disappears", async () => {
    const { getDb, schema } = await import("@/db");
    const { ws } = await makeWorkspace("Retry Co");
    const brand = await createBrand(ws.id, { name: "Retry Co" });
    const campaign = await createCampaign(ws.id, {
      brandId: brand.id, theme: "Test", platforms: ["instagram"], startDate: "2026-11-01", endDate: "2026-11-03", postsPerWeek: 2,
    });
    const db = await getDb();
    // An old attempt that failed 3 times with the 404.
    await db.insert(schema.jobs).values({
      type: "campaign.plan", workspaceId: ws.id, payload: { workspaceId: ws.id, campaignId: campaign.id },
      status: "failed", attempts: 3, error: "No text provider could answer. gemini HTTP 404",
    });
    expect((await campaignJobProblem(ws.id, campaign.id))?.status).toBe("failed");

    // User clicks Retry -> new job runs fine.
    await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: campaign.id }, ws.id);
    await processJobs();
    expect((await getCampaign(ws.id, campaign.id))?.status).toBe("ready");
    expect(await campaignJobProblem(ws.id, campaign.id)).toBeNull();
  });
});
