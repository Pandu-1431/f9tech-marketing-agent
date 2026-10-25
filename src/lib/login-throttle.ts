import crypto from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

/*
 * Sign-in throttling.
 *
 * Two independent counters are kept for every failed sign-in:
 *   - per email address  (stops guessing one account's password)
 *   - per client IP      (stops one machine trying many email addresses)
 * Either counter reaching its limit inside the window locks that key for LOCK minutes.
 * A successful sign-in clears only the email counter: the IP counter is NOT cleared,
 * so an attacker cannot reset it by signing in to their own account between guesses.
 *
 * Keys are SHA-256 hashes, so the table holds no raw emails or IPs, and never passwords.
 */

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

export function throttlePolicy() {
  return {
    maxPerEmail: num(process.env.AUTH_MAX_FAILURES_PER_EMAIL, 5),
    maxPerIp: num(process.env.AUTH_MAX_FAILURES_PER_IP, 20),
    windowMinutes: num(process.env.AUTH_FAILURE_WINDOW_MINUTES, 15),
    lockMinutes: num(process.env.AUTH_LOCK_MINUTES, 15),
  };
}

const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function throttleKeys(email: string, ip: string | null): { email: string; ip: string | null } {
  return {
    email: hash(`email:${email.trim().toLowerCase()}`),
    ip: ip ? hash(`ip:${ip}`) : null,
  };
}

/** Client IP from proxy headers. Returns null when unknown (IP limit is then skipped, email limit still applies). */
export function clientIpFrom(headers: Headers): string | null {
  // TRUSTED_PROXY_HOPS = how many proxies in front of the app append to X-Forwarded-For.
  // The client's address is that many entries from the right; entries further left can be forged.
  const hops = num(process.env.TRUSTED_PROXY_HOPS, 1);
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    const ip = parts.at(-hops) ?? parts[0];
    if (ip) return ip;
  }
  return headers.get("x-real-ip")?.trim() || null;
}

/** Returns the time the sign-in is locked until, or null when allowed. */
export async function lockedUntil(keys: { email: string; ip: string | null }): Promise<Date | null> {
  const db = await getDb();
  const list = [keys.email, ...(keys.ip ? [keys.ip] : [])];
  const rows = await db
    .select({ lockedUntil: schema.loginAttempts.lockedUntil })
    .from(schema.loginAttempts)
    .where(inArray(schema.loginAttempts.key, list));
  const now = Date.now();
  const until = rows
    .map((r) => r.lockedUntil)
    .filter((d): d is Date => Boolean(d) && d!.getTime() > now)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return until ?? null;
}

async function bump(key: string, max: number): Promise<void> {
  const { windowMinutes, lockMinutes } = throttlePolicy();
  const db = await getDb();
  // One atomic upsert: restart the window if it expired, count the failure, lock at the limit.
  await db.execute(sql`
    INSERT INTO ${schema.loginAttempts} (key, failures, window_start, locked_until, updated_at)
    VALUES (${key}, 1, now(), CASE WHEN 1 >= ${max} THEN now() + make_interval(mins => ${lockMinutes}) END, now())
    ON CONFLICT (key) DO UPDATE SET
      failures = CASE WHEN login_attempts.window_start < now() - make_interval(mins => ${windowMinutes})
                      THEN 1 ELSE login_attempts.failures + 1 END,
      window_start = CASE WHEN login_attempts.window_start < now() - make_interval(mins => ${windowMinutes})
                          THEN now() ELSE login_attempts.window_start END,
      locked_until = CASE
        WHEN (CASE WHEN login_attempts.window_start < now() - make_interval(mins => ${windowMinutes})
                   THEN 1 ELSE login_attempts.failures + 1 END) >= ${max}
        THEN now() + make_interval(mins => ${lockMinutes})
        ELSE login_attempts.locked_until END,
      updated_at = now()
  `);
}

export async function recordFailure(keys: { email: string; ip: string | null }): Promise<void> {
  const policy = throttlePolicy();
  await bump(keys.email, policy.maxPerEmail);
  if (keys.ip) await bump(keys.ip, policy.maxPerIp);
}

/** Clears the email counter only (see the note at the top). */
export async function recordSuccess(keys: { email: string; ip: string | null }): Promise<void> {
  const db = await getDb();
  await db.delete(schema.loginAttempts).where(inArray(schema.loginAttempts.key, [keys.email]));
}

export function lockedMessage(): string {
  return `Too many sign-in attempts. Please wait ${throttlePolicy().lockMinutes} minutes and try again.`;
}

/** Same message for unknown email and wrong password, so it never reveals whether an account exists. */
export const FAILED_MESSAGE = "Wrong email or password";
