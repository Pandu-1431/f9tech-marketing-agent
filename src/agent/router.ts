import { and, eq, gte, sql, count } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { freePlan, providerConfig, textChain } from "@/lib/config";
import { assertCanGenerate } from "@/lib/plan";
import { persistRest } from "./provider-state";
import { FakeProvider } from "./providers/fake";
import { GeminiProvider } from "./providers/gemini";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";
import type { TextProvider, TextRequest } from "./providers/types";

/*
 * The Model Router. The rest of the app never calls a model directly: it
 * calls generateText(). The router checks the workspace's free quota, picks
 * the first provider in AGENT_TEXT_CHAIN that is under its daily limit,
 * falls back to the next one on failure, and logs every call.
 * Free -> paid later = change AGENT_TEXT_CHAIN and the keys. No code change.
 */

export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaExceededError";
  }
}

export class AllProvidersFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllProvidersFailedError";
  }
}

/**
 * Every configured AI is busy or out of its free allowance right now. Not a failure: the job
 * waits until `waitUntil` and continues where it stopped (the queue does not count it as a try).
 */
export class AllProvidersBusyError extends AllProvidersFailedError {
  constructor(message: string, public readonly waitUntil: Date) {
    super(message);
    this.name = "AllProvidersBusyError";
  }
}

/** The next time the free daily allowances reset (provider usage is counted per UTC day). */
export function nextDailyReset(now = Date.now()): Date {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 5));
}

export type GenerateContext = {
  workspaceId: number;
  brandId?: number | null;
  purpose: string;
  subject?: { type: string; id: number };
};

export type GenerateOutput = { text: string; provider: string; model: string; generationId: number };

const overrides = new Map<string, TextProvider>();

/** Tests can swap in a custom provider under any name. */
export function registerProvider(provider: TextProvider): void {
  overrides.set(provider.name, provider);
}
export function clearProviderOverrides(): void {
  overrides.clear();
}

export function buildProvider(name: string): { provider: TextProvider; dailyLimit: number; cfg: ReturnType<typeof providerConfig> } | null {
  const cfg = providerConfig(name);
  const override = overrides.get(name);
  if (override) return { provider: override, dailyLimit: cfg?.dailyLimit ?? 100000, cfg };
  if (!cfg) return null;
  if (cfg.driver !== "fake" && !cfg.apiKey) return null; // not configured: skip silently
  const provider =
    cfg.driver === "gemini" ? new GeminiProvider(cfg) : cfg.driver === "fake" ? new FakeProvider() : new OpenAICompatibleProvider(cfg);
  return { provider, dailyLimit: cfg.dailyLimit, cfg };
}

export async function workspaceTextUsageThisMonth(workspaceId: number): Promise<number> {
  const db = await getDb();
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);
  const [row] = await db
    .select({ n: count() })
    .from(schema.generations)
    .where(
      and(
        eq(schema.generations.workspaceId, workspaceId),
        eq(schema.generations.task, "text"),
        eq(schema.generations.status, "ok"),
        gte(schema.generations.createdAt, startOfMonth),
      ),
    );
  return Number(row?.n ?? 0);
}

const today = () => new Date().toISOString().slice(0, 10);

export async function providerRequestsToday(provider: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ requests: schema.providerUsage.requests })
    .from(schema.providerUsage)
    .where(and(eq(schema.providerUsage.provider, provider), eq(schema.providerUsage.day, today())));
  return row?.requests ?? 0;
}

export async function bumpProvider(provider: string): Promise<void> {
  const db = await getDb();
  await db
    .insert(schema.providerUsage)
    .values({ provider, day: today(), requests: 1 })
    .onConflictDoUpdate({
      target: [schema.providerUsage.provider, schema.providerUsage.day],
      set: { requests: sql`${schema.providerUsage.requests} + 1` },
    });
}

/*
 * A provider that just answered "busy" or "over the free limit" is rested for a few minutes,
 * so the next requests go straight to the backup instead of waiting for it to fail again.
 * If every provider is resting, they are still tried (best effort), resting ones last.
 */
const gr = globalThis as unknown as { __textRest?: Map<string, number> };
const restingUntil = (gr.__textRest ??= new Map<string, number>());
const isDailyError = (message: string) => /per ?day|daily|PerDay|tokens per day|\bTPD\b|\bRPD\b/i.test(message);
const cooldownMs = () => Math.max(0, Number(process.env.AGENT_PROVIDER_COOLDOWN_SEC ?? 300)) * 1000;
const isBusyError = (message: string) => /\b(429|503|500|502|504)\b|busy|high demand|quota|free limit|rate limit|timeout|timed out/i.test(message);

/** The chain with rested providers moved to the end. */
export function providerOrder(chain: string[], now = Date.now()): string[] {
  const ready = chain.filter((n) => (restingUntil.get(n) ?? 0) <= now);
  return [...ready, ...chain.filter((n) => !ready.includes(n))];
}
export function restProvider(name: string, now = Date.now(), ms = cooldownMs(), opts: { persist?: boolean } = {}) {
  const until = now + Math.min(ms, cooldownMs() ? ms : 0);
  restingUntil.set(name, until);
  // Remembered across restarts (src/agent/provider-state.ts).
  if (opts.persist !== false && until > now) persistRest(name, "text", until, "busy or over the free limit");
}
/** When a text provider can be used again, or null if it is ready (for the free-AI fuel gauge). */
export function textProviderRest(name: string, now = Date.now()): number | null {
  const t = restingUntil.get(name) ?? 0;
  return t > now ? t : null;
}
/** Tests only. */
export function _resetProviderRest() {
  restingUntil.clear();
}

export async function generateText(ctx: GenerateContext, req: TextRequest): Promise<GenerateOutput> {
  await assertCanGenerate(ctx.workspaceId);
  const limit = freePlan().monthlyTextGenerations;
  if ((await workspaceTextUsageThisMonth(ctx.workspaceId)) >= limit) {
    throw new QuotaExceededError(`Free plan limit reached: ${limit} AI text generations this month.`);
  }

  const db = await getDb();
  const errors: string[] = [];
  const promptLog = `SYSTEM:\n${req.system}\n\nUSER:\n${req.prompt}`;
  // Did every configured AI say "busy / out of free allowance"? Then wait instead of failing.
  let configured = 0;
  let busy = 0;
  let wakeAt = Number.POSITIVE_INFINITY;

  for (const name of providerOrder(textChain())) {
    const built = buildProvider(name);
    if (!built) {
      errors.push(`${name}: not configured`);
      continue;
    }
    configured++;
    if ((await providerRequestsToday(name)) >= built.dailyLimit) {
      errors.push(`${name}: daily free limit reached`);
      busy++;
      wakeAt = Math.min(wakeAt, nextDailyReset().getTime());
      continue;
    }

    const started = Date.now();
    await bumpProvider(name);
    try {
      const result = await built.provider.generate(req);
      const cost =
        ((built.cfg?.costPer1kInputUsd ?? 0) * result.inputTokens + (built.cfg?.costPer1kOutputUsd ?? 0) * result.outputTokens) / 1000;
      const [gen] = await db
        .insert(schema.generations)
        .values({
          workspaceId: ctx.workspaceId,
          brandId: ctx.brandId ?? null,
          subjectType: ctx.subject?.type,
          subjectId: ctx.subject?.id,
          task: "text",
          purpose: ctx.purpose,
          provider: name,
          model: built.provider.model,
          prompt: promptLog,
          output: result.text,
          status: "ok",
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: cost.toFixed(6),
          durationMs: Date.now() - started,
        })
        .returning({ id: schema.generations.id });
      restingUntil.delete(name);
      return { text: result.text, provider: name, model: built.provider.model, generationId: gen.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(message);
      // Out for the day: rest an hour (and check again) instead of asking every 5 minutes.
      if (isBusyError(message)) {
        restProvider(name, Date.now(), isDailyError(message) ? 60 * 60_000 : cooldownMs());
        busy++;
        wakeAt = Math.min(wakeAt, textProviderRest(name) ?? Date.now() + 5 * 60_000);
      }
      await db.insert(schema.generations).values({
        workspaceId: ctx.workspaceId,
        brandId: ctx.brandId ?? null,
        subjectType: ctx.subject?.type,
        subjectId: ctx.subject?.id,
        task: "text",
        purpose: ctx.purpose,
        provider: name,
        model: built.provider.model,
        prompt: promptLog,
        status: "failed",
        error: message.slice(0, 2000),
        durationMs: Date.now() - started,
      });
      // Whatever the error, try the next provider in the chain.
    }
  }

  if (configured > 0 && busy === configured) {
    const at = new Date(Math.max(Date.now() + 60_000, Math.min(wakeAt, Date.now() + 6 * 3600_000)));
    throw new AllProvidersBusyError(`All free AIs are busy or used up for now. ${errors.join(" | ")}`, at);
  }
  throw new AllProvidersFailedError(`No text provider could answer. ${errors.join(" | ")}`);
}
