import { afterEach, describe, expect, it, vi } from "vitest";
import { _resetProviderRest, providerOrder, restProvider } from "@/agent/router";
import { _s3ClientForTests } from "@/lib/storage";

afterEach(() => {
  _resetProviderRest();
  vi.unstubAllEnvs();
});

describe("busy AI providers are skipped for a while", () => {
  it("moves a rested provider to the end, and brings it back after the cooldown", () => {
    const now = Date.now();
    expect(providerOrder(["gemini", "groq"], now)).toEqual(["gemini", "groq"]);
    restProvider("gemini", now);
    expect(providerOrder(["gemini", "groq"], now + 1000)).toEqual(["groq", "gemini"]);
    expect(providerOrder(["gemini", "groq"], now + 301_000)).toEqual(["gemini", "groq"]);
  });
});

describe("Supabase / R2 storage", () => {
  it("uses path-style addresses (https://host/bucket/key), which Supabase needs", async () => {
    vi.stubEnv("S3_ENDPOINT", "https://abc.storage.supabase.co/storage/v1/s3");
    expect(await _s3ClientForTests().config.forcePathStyle).toBe(true);
  });
});
