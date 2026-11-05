import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider, _resetRetiredModels } from "@/agent/providers/openai-compatible";
import { providerConfig } from "@/lib/config";
import { friendlyError } from "@/lib/data";

const cfg = (model: string) => ({ name: "groq", driver: "openai_compatible" as const, apiKey: "gsk_test", model, baseUrl: "https://api.groq.test/v1", dailyLimit: 100, costPer1kInputUsd: 0, costPer1kOutputUsd: 0 });
const answer = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), { status: 200 });
let tried: { model: string; json: boolean }[] = [];

function stub(handler: (model: string, json: boolean) => Response) {
  tried = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    tried.push({ model: body.model, json: Boolean(body.response_format) });
    return handler(body.model, Boolean(body.response_format));
  });
}

beforeEach(() => _resetRetiredModels());
afterEach(() => vi.unstubAllGlobals());

describe("OpenAI-compatible provider (Groq, OpenRouter...)", () => {
  it("defaults Groq to current models (Llama 3.3 was retired in Aug 2026)", () => {
    vi.stubEnv("GROQ_MODEL", "");
    expect(providerConfig("groq")!.model.split(",")[0]).toBe("openai/gpt-oss-120b");
    vi.unstubAllEnvs();
  });

  it("skips a retired model, remembers it, and uses the next one", async () => {
    stub((model) =>
      model === "old-model"
        ? new Response(JSON.stringify({ error: { message: "The model `old-model` does not exist", code: "model_not_found" } }), { status: 404 })
        : answer('{"ok":true}'),
    );
    const p = new OpenAICompatibleProvider(cfg("old-model,new-model"));
    expect((await p.generate({ system: "s", prompt: "p", json: true })).text).toBe('{"ok":true}');
    expect(tried.map((t) => t.model)).toEqual(["old-model", "new-model"]);
    tried = [];
    await p.generate({ system: "s", prompt: "p" });
    expect(tried.map((t) => t.model)).toEqual(["new-model"]); // the retired one is not tried again
  });

  it("moves to the next model when one is busy (429/503)", async () => {
    stub((model) => (model === "a" ? new Response("busy", { status: 503 }) : answer("hi")));
    expect((await new OpenAICompatibleProvider(cfg("a,b")).generate({ system: "s", prompt: "p" })).text).toBe("hi");
  });

  it("asks again without JSON mode when a model can't do it", async () => {
    stub((_m, json) => (json ? new Response(JSON.stringify({ error: { message: "response_format json_object is not supported" } }), { status: 400 }) : answer("{}")));
    expect((await new OpenAICompatibleProvider(cfg("a")).generate({ system: "s", prompt: "p", json: true })).text).toBe("{}");
    expect(tried).toEqual([{ model: "a", json: true }, { model: "a", json: false }]);
  });

  it("all busy = retryable error listing each model", async () => {
    stub(() => new Response("over quota", { status: 429 }));
    await expect(new OpenAICompatibleProvider(cfg("a,b")).generate({ system: "s", prompt: "p" })).rejects.toMatchObject({ retryable: true });
  });
});

describe("friendly errors on the post card", () => {
  it("turns raw AI errors into plain advice", () => {
    expect(friendlyError("No text provider could answer. gemini: busy (503)")).toMatch(/busy or out of free requests/);
    expect(friendlyError("getaddrinfo ENOTFOUND media.abcdxyz.supabase.co")).toMatch(/Could not reach/);
  });
});
