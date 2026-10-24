import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { clearProviderOverrides, generateText, QuotaExceededError, registerProvider, AllProvidersFailedError } from "@/agent/router";
import { ProviderError } from "@/agent/providers/types";
import { GeminiProvider } from "@/agent/providers/gemini";
import { providerConfig } from "@/lib/config";
import { freshDb, makeWorkspace } from "./helpers";

const ok = (name: string, text = "hello") => ({
  name,
  model: `${name}-model`,
  generate: async () => ({ text, inputTokens: 10, outputTokens: 5 }),
});
const broken = (name: string) => ({
  name,
  model: `${name}-model`,
  generate: async () => {
    throw new ProviderError(`${name} HTTP 429: rate limited`, 429);
  },
});

describe("model router", () => {
  beforeEach(async () => {
    await freshDb();
    clearProviderOverrides();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearProviderOverrides();
  });

  it("falls back to the next provider and logs both calls", async () => {
    vi.stubEnv("AGENT_TEXT_CHAIN", "gemini,groq");
    registerProvider(broken("gemini"));
    registerProvider(ok("groq", "from groq"));
    const { ws } = await makeWorkspace();
    const db = await freshDbKeep();

    const out = await generateText({ workspaceId: ws.id, purpose: "test" }, { system: "s", prompt: "p" });
    expect(out.provider).toBe("groq");
    expect(out.text).toBe("from groq");

    const logs = await db.select().from(schema.generations).where(eq(schema.generations.workspaceId, ws.id));
    expect(logs.map((l) => `${l.provider}:${l.status}`)).toEqual(["gemini:failed", "groq:ok"]);
  });

  it("skips a provider that hit its daily free limit", async () => {
    vi.stubEnv("AGENT_TEXT_CHAIN", "gemini,groq");
    vi.stubEnv("GEMINI_DAILY_LIMIT", "1");
    registerProvider(ok("gemini", "g"));
    registerProvider(ok("groq", "q"));
    const { ws } = await makeWorkspace();

    expect((await generateText({ workspaceId: ws.id, purpose: "t" }, { system: "s", prompt: "p" })).provider).toBe("gemini");
    expect((await generateText({ workspaceId: ws.id, purpose: "t" }, { system: "s", prompt: "p" })).provider).toBe("groq");
  });

  it("stops at the workspace's monthly free limit", async () => {
    vi.stubEnv("AGENT_MONTHLY_TEXT_GENERATIONS", "2");
    const { ws } = await makeWorkspace();
    await generateText({ workspaceId: ws.id, purpose: "t" }, { system: "s", prompt: "p" });
    await generateText({ workspaceId: ws.id, purpose: "t" }, { system: "s", prompt: "p" });
    await expect(generateText({ workspaceId: ws.id, purpose: "t" }, { system: "s", prompt: "p" })).rejects.toBeInstanceOf(
      QuotaExceededError,
    );
  });

  it("explains when no provider is configured", async () => {
    vi.stubEnv("AGENT_TEXT_CHAIN", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "");
    const { ws } = await makeWorkspace();
    await expect(generateText({ workspaceId: ws.id, purpose: "t" }, { system: "s", prompt: "p" })).rejects.toBeInstanceOf(
      AllProvidersFailedError,
    );
  });

  it("calls the Gemini REST API with the right shape", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const provider = new GeminiProvider(providerConfig("gemini")!);
    const res = await provider.generate({ system: "sys", prompt: "hi", json: true });

    expect(res).toEqual({ text: '{"ok":true}', inputTokens: 12, outputTokens: 3 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(":generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(String(init.body));
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.systemInstruction.parts[0].text).toBe("sys");
  });
});

async function freshDbKeep() {
  const { getDb } = await import("@/db");
  return getDb();
}

describe("gemini model handling", () => {
  beforeEach(async () => {
    const { resetGeminiState } = await import("@/agent/providers/gemini");
    resetGeminiState();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const okBody = (text = "hi") => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
  const modelOf = (url: string) => url.split("/models/")[1].split(":")[0];

  async function provider() {
    const { GeminiProvider } = await import("@/agent/providers/gemini");
    return new GeminiProvider(providerConfig("gemini")!);
  }

  it("reads the replacement model from Google's 404 message", async () => {
    const { suggestedModel } = await import("@/agent/providers/gemini");
    const msg =
      '{"error":{"code":404,"message":"This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features and improvements.","status":"NOT_FOUND"}}';
    expect(suggestedModel(msg)).toBe("gemini-3.8-flash");
    expect(suggestedModel("nothing here")).toBeNull();
  });

  it("never calls a retired model (GEMINI_MODEL=gemini-2.5-flash) and uses the fast lite model", async () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    vi.stubEnv("GEMINI_MODEL", "gemini-2.5-flash");
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (urls.push(url), okBody())));
    const p = await provider();
    await p.generate({ system: "s", prompt: "p" });
    expect(urls.map(modelOf)).toEqual(["gemini-flash-lite-latest"]);
    expect(p.model).toBe("gemini-flash-lite-latest");
  });

  it("moves to the next model when one is busy (503) or over its free limit (429), and rests it", async () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    vi.stubEnv("GEMINI_MODEL", "gemini-3.8-flash,gemini-flash-lite-latest");
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes("3.8")) return new Response('{"error":{"code":503,"message":"This model is currently experiencing high demand."}}', { status: 503 });
      return okBody("from lite");
    }));
    const p = await provider();
    expect((await p.generate({ system: "s", prompt: "p" })).text).toBe("from lite");
    await p.generate({ system: "s", prompt: "p" }); // 3.8 is resting now: straight to lite
    expect(urls.map(modelOf)).toEqual(["gemini-3.8-flash", "gemini-flash-lite-latest", "gemini-flash-lite-latest"]);
  });

  it("moves on when a model is too slow", async () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    vi.stubEnv("GEMINI_MODEL", "gemini-slow-flash,gemini-flash-lite-latest");
    vi.stubEnv("GEMINI_MODEL_TIMEOUT_MS", "200");
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes("slow"))
        return new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"))));
      return okBody("fast");
    }));
    const p = await provider();
    expect((await p.generate({ system: "s", prompt: "p" })).text).toBe("fast");
  });

  it("follows Google's suggested replacement on a 404", async () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    vi.stubEnv("GEMINI_MODEL", "gemini-old-flash");
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes("old")) return new Response('{"error":{"message":"gone. Please update your code to use models/gemini-new-flash for more."}}', { status: 404 });
      return okBody();
    }));
    const p = await provider();
    await p.generate({ system: "s", prompt: "p" });
    expect(urls.map(modelOf)).toEqual(["gemini-old-flash", "gemini-new-flash"]);
  });

  it("retries without the thinking setting if a model rejects it", async () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    vi.stubEnv("GEMINI_MODEL", "gemini-9-flash");
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      if (body.generationConfig.thinkingConfig) return new Response('{"error":{"message":"Unknown field thinkingLevel in thinking_config"}}', { status: 400 });
      return okBody("ok");
    }));
    const p = await provider();
    expect((await p.generate({ system: "s", prompt: "p" })).text).toBe("ok");
    expect(bodies).toHaveLength(2);
  });

  it("gives a clear, retryable error when every model is busy", async () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"code":429,"message":"You exceeded your current quota"}}', { status: 429 })));
    const p = await provider();
    const err = await p.generate({ system: "s", prompt: "p" }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(true);
    expect(err.message).toContain("free limit reached");
  });
});
