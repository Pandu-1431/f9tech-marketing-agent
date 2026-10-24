import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectionRows, testConnection } from "@/lib/connections";
import { freshDb } from "./helpers";

describe("AI connections page", () => {
  beforeEach(async () => {
    await freshDb();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("shows which providers are ready and which need a key", async () => {
    vi.stubEnv("AGENT_TEXT_CHAIN", "gemini,fake");
    vi.stubEnv("GEMINI_API_KEY", "");
    const rows = await connectionRows();
    const gemini = rows.find((r) => r.task === "text" && r.name === "gemini")!;
    expect(gemini.configured).toBe(false);
    expect(gemini.env).toEqual(["GEMINI_API_KEY"]);
    expect(rows.find((r) => r.task === "text" && r.name === "fake")?.configured).toBe(true);
    expect(rows.some((r) => r.task === "voice" && r.name === "silent")).toBe(true);
  });

  it("tests a provider with a tiny request", async () => {
    expect((await testConnection("text", "fake")).ok).toBe(true);
    expect((await testConnection("image", "fake")).ok).toBe(true);
    expect((await testConnection("voice", "silent")).ok).toBe(true);
    vi.stubEnv("GEMINI_API_KEY", "");
    const r = await testConnection("text", "gemini");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Not configured/);
  });
});
