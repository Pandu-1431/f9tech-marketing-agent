import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db";
import { clientIpFrom, lockedUntil, recordFailure, recordSuccess, throttleKeys } from "@/lib/login-throttle";
import { freshDb } from "./helpers";

async function failTimes(keys: ReturnType<typeof throttleKeys>, n: number) {
  for (let i = 0; i < n; i++) await recordFailure(keys);
}

describe("login throttling", () => {
  beforeEach(async () => {
    await freshDb();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("locks an email after 5 failures, not before", async () => {
    const keys = throttleKeys("Owner@Example.com", "203.0.113.5");
    await failTimes(keys, 4);
    expect(await lockedUntil(keys)).toBeNull();
    await recordFailure(keys);
    const until = await lockedUntil(keys);
    expect(until).not.toBeNull();
    expect(until!.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
  });

  it("treats email case and spaces as the same account", async () => {
    await failTimes(throttleKeys("owner@example.com", null), 5);
    expect(await lockedUntil(throttleKeys("  OWNER@example.COM ", null))).not.toBeNull();
  });

  it("the lock covers the email from any IP", async () => {
    await failTimes(throttleKeys("victim@example.com", "198.51.100.1"), 5);
    expect(await lockedUntil(throttleKeys("victim@example.com", "198.51.100.99"))).not.toBeNull();
  });

  it("changing the email does not bypass the IP limit (20 failures per IP)", async () => {
    const ip = "203.0.113.77";
    for (let i = 0; i < 20; i++) await recordFailure(throttleKeys(`user${i}@example.com`, ip));
    expect(await lockedUntil(throttleKeys("fresh@example.com", ip))).not.toBeNull();
    // Another IP is not affected.
    expect(await lockedUntil(throttleKeys("fresh@example.com", "203.0.113.78"))).toBeNull();
  });

  it("a successful sign-in clears the email counter but not the IP counter", async () => {
    const ip = "203.0.113.9";
    for (let i = 0; i < 19; i++) await recordFailure(throttleKeys(`x${i}@example.com`, ip));
    const mine = throttleKeys("attacker-own@example.com", ip);
    await failTimes(mine, 4);
    await recordSuccess(mine);
    // Email counter reset: 4 more failures don't lock the email...
    await failTimes(throttleKeys("attacker-own@example.com", null), 4);
    expect(await lockedUntil(throttleKeys("attacker-own@example.com", null))).toBeNull();
    // ...but the IP counter kept counting (19 + 4 = 23 >= 20), so the IP is locked.
    expect(await lockedUntil(throttleKeys("someone@example.com", ip))).not.toBeNull();
  });

  it("a legitimate user can sign in again once the lock expires", async () => {
    const keys = throttleKeys("legit@example.com", "192.0.2.10");
    await failTimes(keys, 5);
    expect(await lockedUntil(keys)).not.toBeNull();
    const db = await getDb();
    await db.update(schema.loginAttempts).set({ lockedUntil: new Date(Date.now() - 1000), windowStart: new Date(Date.now() - 60 * 60_000) });
    expect(await lockedUntil(keys)).toBeNull();
    // An old window restarts: one new failure does not lock again.
    await recordFailure(keys);
    expect(await lockedUntil(keys)).toBeNull();
  });

  it("limits come from settings", async () => {
    vi.stubEnv("AUTH_MAX_FAILURES_PER_EMAIL", "2");
    const keys = throttleKeys("strict@example.com", null);
    await failTimes(keys, 2);
    expect(await lockedUntil(keys)).not.toBeNull();
  });

  it("stores only hashes, never raw emails or IPs", async () => {
    await recordFailure(throttleKeys("private@example.com", "192.0.2.44"));
    const db = await getDb();
    const rows = await db.select().from(schema.loginAttempts);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.key).toMatch(/^[0-9a-f]{64}$/);
      expect(r.key).not.toContain("private");
    }
  });

  it("reads the client IP from proxy headers, ignoring forged entries", () => {
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.5" }))).toBe("203.0.113.5");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
    expect(clientIpFrom(new Headers({ "x-real-ip": "198.51.100.3" }))).toBe("198.51.100.3");
    expect(clientIpFrom(new Headers())).toBeNull();
  });
});
