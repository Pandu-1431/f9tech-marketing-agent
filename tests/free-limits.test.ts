import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyLimit, imageProviderRest, nextUtcMidnight, _resetImageLimits } from "@/agent/images/limits";
import { clearImageProviderOverrides, fullImageChain, generateImage, registerImageProvider } from "@/agent/images/router";
import { BrandArtImageProvider } from "@/agent/images/providers";
import { ProviderError } from "@/agent/providers/types";
import { voiceChunks } from "@/agent/video/voice";
import { freshDb, makeWorkspace } from "./helpers";

const CF_DAILY =
  'cloudflare HTTP 429: {"errors":[{"message":"AiError: AiError: you have used up your daily free allocation of 10,000 neurons, please upgrade","code":4006}]}';
const POLL_SPEED =
  'pollinations HTTP 402: {"status":402,"error":{"code":"FREE_LIMIT","message":"Free limit reached: 1 image every 45 seconds per IP. Retry after 43s, or get unlimited images with a pollen key"}}';

describe("free AI limits", () => {
  beforeEach(async () => {
    await freshDb();
    _resetImageLimits();
    clearImageProviderOverrides();
    vi.stubEnv("AGENT_PROVIDER_COOLDOWN_SEC", "300");
    vi.stubEnv("POLLINATIONS_INTERVAL_SEC", "0");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    clearImageProviderOverrides();
    _resetImageLimits();
  });

  it("reads Cloudflare's daily limit and Pollinations' speed limit", () => {
    expect(classifyLimit(429, CF_DAILY)).toEqual({ kind: "daily" });
    expect(classifyLimit(402, POLL_SPEED)).toEqual({ kind: "wait", ms: 43_000 });
    expect(classifyLimit(400, "bad request")).toBeNull();
    expect(nextUtcMidnight(Date.UTC(2026, 10, 5, 17, 0))).toBe(Date.UTC(2026, 10, 6));
  });

  it("a provider out for the day is skipped until 05:30 IST, and brand art keeps posters coming", async () => {
    const { ws } = await makeWorkspace("Limits Co");
    let calls = 0;
    registerImageProvider({
      name: "cloudflare",
      model: "stub",
      generate: async () => {
        calls++;
        throw new ProviderError(CF_DAILY, 429);
      },
    });
    vi.stubEnv("AGENT_IMAGE_CHAIN", "cloudflare");
    expect(fullImageChain()).toEqual(["cloudflare", "stock", "brand_art"]);
    // Real photos first when the business wants them.
    expect(fullImageChain("real")).toEqual(["stock", "cloudflare", "brand_art"]);
    const a = await generateImage({ workspaceId: ws.id, purpose: "post_background" }, { prompt: "x", width: 400, height: 500, colors: ["#3730a3", "#f59e0b"], seed: 3 });
    expect(a.provider).toBe("brand_art");
    expect(a.data.length).toBeGreaterThan(1000);
    expect(imageProviderRest("cloudflare")?.until).toBe(nextUtcMidnight());
    await generateImage({ workspaceId: ws.id, purpose: "post_background" }, { prompt: "y", width: 400, height: 500 });
    expect(calls).toBe(1); // not asked again today
  });

  it("waits and retries once when a provider says 'too fast'", async () => {
    const { ws } = await makeWorkspace("Speed Co");
    let calls = 0;
    const art = new BrandArtImageProvider();
    registerImageProvider({
      name: "pollinations",
      model: "stub",
      generate: async (r) => {
        calls++;
        if (calls === 1) throw new ProviderError(POLL_SPEED.replace("43s", "1s"), 402);
        return art.generate(r);
      },
    });
    vi.stubEnv("AGENT_IMAGE_CHAIN", "pollinations");
    const t0 = Date.now();
    const out = await generateImage({ workspaceId: ws.id, purpose: "post_background" }, { prompt: "x", width: 300, height: 300 });
    expect(out.provider).toBe("pollinations");
    expect(calls).toBe(2);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900); // it waited what the provider asked
  });

  it("splits long voice lines into short pieces", () => {
    const text = "word ".repeat(100).trim();
    const parts = voiceChunks(text, 50);
    expect(parts.every((p) => p.length <= 50)).toBe(true);
    expect(parts.join(" ")).toBe(text);
  });
});
