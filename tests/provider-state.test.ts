import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetImageLimits, imageProviderRest, restImageProvider } from "@/agent/images/limits";
import { loadRests, restoreProviderState } from "@/agent/provider-state";
import { _resetProviderRest, providerOrder, restProvider, textProviderRest } from "@/agent/router";
import { getDb, schema } from "@/db";
import { freshDb } from "./helpers";

const flush = () => new Promise((r) => setTimeout(r, 30)); // persistRest is fire-and-forget

describe("free-AI rest state survives a restart", () => {
  beforeEach(async () => {
    await freshDb();
    _resetImageLimits();
  });
  afterEach(() => {
    _resetProviderRest();
    _resetImageLimits();
    vi.unstubAllEnvs();
  });

  it("saves a text rest and an image rest, and loads only the ones still in the future", async () => {
    const now = Date.now();
    restProvider("gemini", now, 60 * 60_000); // out for the day: an hour's rest
    restImageProvider("cloudflare", now + 5 * 3600_000, "free daily limit used up");
    restImageProvider("pollinations", now - 1000, "already over"); // in the past: not restored
    await flush();
    const db = await getDb();
    expect((await db.select().from(schema.providerState)).length).toBe(3);
    const rests = await loadRests(new Date(now));
    expect(rests.map((r) => `${r.task}:${r.provider}`).sort()).toEqual(["image:cloudflare", "text:gemini"]);

    // "Restart": memory is empty, then restored from the database.
    _resetProviderRest();
    _resetImageLimits();
    expect(providerOrder(["gemini", "groq"], now + 1000)).toEqual(["gemini", "groq"]);
    expect(imageProviderRest("cloudflare", now + 1000)).toBeNull();
    expect(await restoreProviderState(new Date(now + 1000))).toBe(2);
    expect(providerOrder(["gemini", "groq"], now + 1000)).toEqual(["groq", "gemini"]);
    expect(textProviderRest("gemini", now + 1000)).toBeGreaterThan(now + 59 * 60_000);
    expect(imageProviderRest("cloudflare", now + 1000)?.reason).toBe("free daily limit used up");
    // Restoring does not write the rows again.
    await flush();
    expect((await db.select().from(schema.providerState)).length).toBe(3);
  });

  it("a second rest for the same provider replaces the first (one row per provider and task)", async () => {
    const now = Date.now();
    restProvider("groq", now, 300_000);
    await flush();
    restProvider("groq", now, 3600_000);
    await flush();
    const db = await getDb();
    const rows = await db.select().from(schema.providerState);
    expect(rows).toHaveLength(1);
    expect(rows[0].restUntil.getTime()).toBeGreaterThan(now + 3500_000);
  });

  it("writes nothing when cooldowns are switched off (browser tests)", async () => {
    vi.stubEnv("AGENT_PROVIDER_COOLDOWN_SEC", "0");
    restProvider("gemini", Date.now(), 60_000);
    restImageProvider("cloudflare", Date.now() + 60_000, "x");
    await flush();
    const db = await getDb();
    expect(await db.select().from(schema.providerState)).toEqual([]);
  });
});
