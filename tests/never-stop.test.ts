import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { AllProvidersBusyError, AllProvidersFailedError, clearProviderOverrides, generateText, nextDailyReset, registerProvider } from "@/agent/router";
import { processJobs, enqueue } from "@/jobs/queue";
import { createBrand, createCampaign, listCampaignPosts } from "@/lib/data";
import { providerConfig, textChain } from "@/lib/config";
import { FakeProvider } from "@/agent/providers/fake";
import { freshDb, makeWorkspace } from "./helpers";

const busy = (name: string) => ({ name, model: "m", generate: async () => { throw new Error(`${name} 429 rate limit: requests per day`); } });

describe("never stop: wait for free AI instead of failing", () => {
  beforeEach(async () => {
    await freshDb();
    clearProviderOverrides();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    clearProviderOverrides();
  });

  it("knows the new free AIs, in order, with their real daily limits", () => {
    const saved = process.env.AGENT_TEXT_CHAIN;
    delete process.env.AGENT_TEXT_CHAIN; // the default chain, as a fresh install has it
    expect(textChain()).toEqual(["gemini", "groq", "cerebras", "mistral", "openrouter", "github"]);
    process.env.AGENT_TEXT_CHAIN = saved;
    expect(providerConfig("gemini")!.dailyLimit).toBe(900);
    expect(providerConfig("groq")!.dailyLimit).toBe(1000);
    expect(providerConfig("cerebras")).toMatchObject({ baseUrl: "https://api.cerebras.ai/v1", dailyLimit: 1000 });
    expect(providerConfig("mistral")!.model.split(",")[0]).toBe("mistral-small-latest");
    expect(providerConfig("github")!.baseUrl).toBe("https://models.github.ai/inference");
    expect(nextDailyReset(Date.parse("2026-11-07T18:30:00Z")).toISOString()).toBe("2026-11-08T00:05:00.000Z");
  });

  it("says 'busy, wait until …' only when every configured AI is busy", async () => {
    const { ws } = await makeWorkspace("Busy");
    vi.stubEnv("AGENT_TEXT_CHAIN", "gemini,groq");
    registerProvider(busy("gemini"));
    registerProvider(busy("groq"));
    const err = await generateText({ workspaceId: ws.id, purpose: "t" }, { system: "s", prompt: "p" }).catch((e) => e);
    expect(err).toBeInstanceOf(AllProvidersBusyError);
    expect((err as AllProvidersBusyError).waitUntil.getTime()).toBeGreaterThan(Date.now());

    clearProviderOverrides();
    registerProvider({ name: "gemini", model: "m", generate: async () => { throw new Error("400 API key not valid"); } });
    registerProvider(busy("groq"));
    const broken = await generateText({ workspaceId: ws.id, purpose: "t" }, { system: "s", prompt: "p" }).catch((e) => e);
    expect(broken).toBeInstanceOf(AllProvidersFailedError);
    expect(broken).not.toBeInstanceOf(AllProvidersBusyError); // a wrong key is a real problem, shown as one
  });

  it("a campaign whose AIs are all busy waits (no try used up) and finishes when one is back", async () => {
    const { ws } = await makeWorkspace("Wait");
    vi.stubEnv("AGENT_TEXT_CHAIN", "gemini");
    const brand = await createBrand(ws.id, { name: "Shop", colors: [], platforms: ["instagram"] });
    const campaign = await createCampaign(ws.id, { brandId: brand.id, theme: "Offer", platforms: ["instagram"], startDate: "2026-11-09", endDate: "2026-11-15", postsPerWeek: 2 });
    const text = new FakeProvider();
    registerProvider({ name: "gemini", model: "m", generate: (r) => text.generate(r) });
    await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: campaign.id }, ws.id);
    await processJobs(1); // plan
    registerProvider(busy("gemini")); // now every AI is out
    await processJobs(1); // write -> waits
    const db = await getDb();
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.type, "campaign.write"));
    expect(job.status).toBe("queued");
    expect(job.attempts).toBe(0); // the wait did not count as a try
    expect(job.error).toMatch(/^Waiting for free AI until /);
    expect(job.runAfter.getTime()).toBeGreaterThan(Date.now());
    const [c] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaign.id));
    expect(c.status).not.toBe("failed");

    // The AI is back: the job continues and writes the posts.
    registerProvider({ name: "gemini", model: "m", generate: (r) => text.generate(r) });
    await db.update(schema.jobs).set({ runAfter: new Date(Date.now() - 1000) }).where(eq(schema.jobs.id, job.id));
    await processJobs(1);
    const posts = await listCampaignPosts(ws.id, campaign.id);
    expect(posts.every((p) => p.status === "drafted")).toBe(true);
  });
});
