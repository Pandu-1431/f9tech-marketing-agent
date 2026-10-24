import { and, eq, gte, sql, count } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { freePlan, providerConfig, textChain } from "@/lib/config";
import { assertCanGenerate } from "@/lib/plan";
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

function buildProvider(name: string): { provider: TextProvider; dailyLimit: number; cfg: ReturnType<typeof providerConfig> } | null {
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

export async function generateText(ctx: GenerateContext, req: TextRequest): Promise<GenerateOutput> {
  await assertCanGenerate(ctx.workspaceId);
  const limit = freePlan().monthlyTextGenerations;
  if ((await workspaceTextUsageThisMonth(ctx.workspaceId)) >= limit) {
    throw new QuotaExceededError(`Free plan limit reached: ${limit} AI text generations this month.`);
  }

  const db = await getDb();
  const errors: string[] = [];
  const promptLog = `SYSTEM:\n${req.system}\n\nUSER:\n${req.prompt}`;

  for (const name of textChain()) {
    const built = buildProvider(name);
    if (!built) {
      errors.push(`${name}: not configured`);
      continue;
    }
    if ((await providerRequestsToday(name)) >= built.dailyLimit) {
      errors.push(`${name}: daily free limit reached`);
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
      return { text: result.text, provider: name, model: built.provider.model, generationId: gen.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(message);
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

  throw new AllProvidersFailedError(`No text provider could answer. ${errors.join(" | ")}`);
}
