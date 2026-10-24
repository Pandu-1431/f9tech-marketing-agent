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
