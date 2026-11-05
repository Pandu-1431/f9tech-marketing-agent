/*
 * Free image AIs have two kinds of limits:
 *   - a daily allowance (Cloudflare: resets 00:00 UTC = 05:30 IST)
 *   - a speed limit (Pollinations without a token: 1 image every ~45 seconds per IP)
 * This file remembers both, so the router waits politely instead of failing,
 * and skips a provider that is out for the day instead of asking it again and again.
 * State lives on globalThis so the web server and the inline worker share it.
 */

type LimitState = {
  restUntil: Map<string, number>;
  restReason: Map<string, string>;
  nextSlot: Map<string, number>;
};
const g = globalThis as unknown as { __imageLimits?: LimitState };
const state = (): LimitState => (g.__imageLimits ??= { restUntil: new Map(), restReason: new Map(), nextSlot: new Map() });

export function _resetImageLimits() {
  g.__imageLimits = undefined;
}

const cooldownOff = () => process.env.AGENT_PROVIDER_COOLDOWN_SEC === "0";

/** Next 00:00 UTC (when Cloudflare's free daily allowance comes back). */
export function nextUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

export function restImageProvider(name: string, untilMs: number, reason: string) {
  if (cooldownOff()) return;
  state().restUntil.set(name, untilMs);
  state().restReason.set(name, reason);
}

/** When the provider can be used again (ms), or null when it is ready now. */
export function imageProviderRest(name: string, now = Date.now()): { until: number; reason: string } | null {
  const until = state().restUntil.get(name);
  if (!until || until <= now) return null;
  return { until, reason: state().restReason.get(name) ?? "resting" };
}

/** Minimum gap between two calls to the same provider (speed limits). */
export function minIntervalMs(name: string): number {
  if (cooldownOff()) return 0;
  if (name === "pollinations") {
    const sec = Number(process.env.POLLINATIONS_INTERVAL_SEC);
    if (Number.isFinite(sec) && sec >= 0) return sec * 1000;
    return process.env.POLLINATIONS_TOKEN ? 6_000 : 46_000;
  }
  return 0;
}

/**
 * Books the next free slot for a speed-limited provider and waits for it.
 * Returns false (without waiting) when the queue is longer than maxWaitMs.
 */
export async function waitForSlot(name: string, maxWaitMs: number): Promise<boolean> {
  const gap = minIntervalMs(name);
  const now = Date.now();
  const booked = state().nextSlot.get(name) ?? 0;
  if (!gap && booked <= now) return true;
  const slot = Math.max(now, booked);
  if (slot - now > maxWaitMs) return false;
  state().nextSlot.set(name, slot + gap);
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
  return true;
}

/** After a "too fast" answer: push the next slot back by the time the provider asked for. */
export function pushSlot(name: string, waitMs: number) {
  const s = state();
  s.nextSlot.set(name, Math.max(s.nextSlot.get(name) ?? 0, Date.now() + waitMs));
}

export type LimitKind = { kind: "daily" } | { kind: "wait"; ms: number } | { kind: "rest"; ms: number } | null;

/** Reads a provider error and says what kind of limit it was. */
export function classifyLimit(status: number | undefined, message: string): LimitKind {
  const m = message.toLowerCase();
  const retry = m.match(/retry after (\d+)\s*s/) ?? m.match(/every (\d+)\s*sec/) ?? m.match(/(\d+)\s*seconds?/);
  if (/daily|allocation|per day|neurons|monthly|credits|quota exceeded|exceeded your current quota/.test(m) && (status === 429 || status === 402 || status === 403)) {
    return { kind: "daily" };
  }
  if (status === 429 || status === 402 || /free_limit|rate limit|too many requests/.test(m)) {
    const sec = retry ? Number(retry[1]) : 60;
    return { kind: "wait", ms: Math.min(Math.max(sec, 5), 300) * 1000 };
  }
  if (status && status >= 500) return { kind: "rest", ms: 60_000 };
  return null;
}
