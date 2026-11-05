import { and, count, eq, gte, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { freePlan, imageChain, imageProviderConfig } from "@/lib/config";
import { assertCanGenerate } from "@/lib/plan";
import { QuotaExceededError, AllProvidersFailedError, bumpProvider, providerRequestsToday } from "../router";
import { classifyLimit, imageProviderRest, nextUtcMidnight, pushSlot, restImageProvider, waitForSlot } from "./limits";
import { ProviderError } from "../providers/types";
import {
  BrandArtImageProvider,
  CloudflareImageProvider,
  FakeImageProvider,
  HuggingFaceImageProvider,
  PollinationsImageProvider,
  type ImageProvider,
  type ImageRequest,
  type ImageResult,
} from "./providers";

/*
 * Image router: same rules as the text router. Tries AGENT_IMAGE_CHAIN in order,
 * respects daily provider caps and the workspace's monthly image limit,
 * logs every call in `generations`. Paid models later = add an adapter + config.
 */

const overrides = new Map<string, ImageProvider>();
export function registerImageProvider(p: ImageProvider) {
  overrides.set(p.name, p);
}
export function clearImageProviderOverrides() {
  overrides.clear();
}

export function buildImageProvider(name: string): { provider: ImageProvider; dailyLimit: number } | null {
  const cfg = imageProviderConfig(name);
  const o = overrides.get(name);
  if (o) return { provider: o, dailyLimit: cfg?.dailyLimit ?? 1_000_000 };
  if (!cfg) return null;
  switch (cfg.driver) {
    case "cloudflare":
      return cfg.apiKey && cfg.accountId ? { provider: new CloudflareImageProvider(cfg), dailyLimit: cfg.dailyLimit } : null;
    case "huggingface":
      return cfg.apiKey ? { provider: new HuggingFaceImageProvider(cfg), dailyLimit: cfg.dailyLimit } : null;
    case "pollinations":
      return { provider: new PollinationsImageProvider(cfg), dailyLimit: cfg.dailyLimit };
    case "brand_art":
      return { provider: new BrandArtImageProvider(), dailyLimit: cfg.dailyLimit };
    case "fake":
      return { provider: new FakeImageProvider(), dailyLimit: cfg.dailyLimit };
  }
}

export async function workspaceImageUsageThisMonth(workspaceId: number): Promise<number> {
  const db = await getDb();
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const [row] = await db
    .select({ n: count() })
    .from(schema.generations)
    .where(
      and(
        eq(schema.generations.workspaceId, workspaceId),
        eq(schema.generations.task, "image"),
        eq(schema.generations.status, "ok"),
        ne(schema.generations.provider, "brand_art"), // local design work is free and unlimited
        gte(schema.generations.createdAt, start),
      ),
    );
  return Number(row?.n ?? 0);
}

/**
 * The chain from AGENT_IMAGE_CHAIN plus a last step that always works: "brand_art"
 * (a designed on-brand background), so posters and reels are never blocked by free limits.
 * AGENT_IMAGE_FALLBACK=off turns that off.
 */
export function fullImageChain(): string[] {
  const chain = imageChain();
  if (process.env.AGENT_IMAGE_FALLBACK === "off" || chain.includes("fake") || chain.includes("brand_art")) return chain;
  return [...chain, "brand_art"];
}

export type ImageContext = { workspaceId: number; brandId?: number | null; purpose: string; subject?: { type: string; id: number } };

export async function generateImage(ctx: ImageContext, req: ImageRequest): Promise<ImageResult & { provider: string; model: string }> {
  await assertCanGenerate(ctx.workspaceId);
  const limit = freePlan().monthlyImageGenerations;
  if ((await workspaceImageUsageThisMonth(ctx.workspaceId)) >= limit) {
    throw new QuotaExceededError(`Image limit reached: ${limit} images this month.`);
  }

  const db = await getDb();
  const errors: string[] = [];
  const maxWaitMs = Math.max(0, Number(process.env.AGENT_IMAGE_MAX_WAIT_SEC ?? 150)) * 1000;
  const log = (name: string, model: string, started: number, extra: Partial<typeof schema.generations.$inferInsert>) =>
    db.insert(schema.generations).values({
      workspaceId: ctx.workspaceId,
      brandId: ctx.brandId ?? null,
      subjectType: ctx.subject?.type,
      subjectId: ctx.subject?.id,
      task: "image",
      purpose: ctx.purpose,
      provider: name,
      model,
      prompt: req.prompt,
      durationMs: Date.now() - started,
      status: "ok",
      ...extra,
    });

  for (const name of fullImageChain()) {
    const built = buildImageProvider(name);
    if (!built) {
      errors.push(`${name}: not configured`);
      continue;
    }
    const rest = imageProviderRest(name);
    if (rest) {
      errors.push(`${name}: ${rest.reason}`);
      continue;
    }
    if ((await providerRequestsToday(`image:${name}`)) >= built.dailyLimit) {
      errors.push(`${name}: daily free limit reached`);
      continue;
    }
    // Speed-limited providers (Pollinations): wait for our turn instead of being refused.
    // Two tries: if the provider says "too fast", wait what it asks and try once more.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!(await waitForSlot(name, maxWaitMs))) {
        errors.push(`${name}: busy (speed limit), skipped`);
        break;
      }
      const started = Date.now();
      await bumpProvider(`image:${name}`);
      try {
        const out = await built.provider.generate(req);
        await log(name, built.provider.model, started, { output: `${out.mime}, ${out.data.length} bytes` });
        return { ...out, provider: name, model: built.provider.model };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await log(name, built.provider.model, started, { status: "failed", error: message.slice(0, 2000) });
        const limit = classifyLimit(err instanceof ProviderError ? err.status : undefined, message);
        if (limit?.kind === "daily") {
          restImageProvider(name, nextUtcMidnight(), "free daily limit used up (back at 05:30 IST)");
          errors.push(`${name}: free daily limit used up`);
          break;
        }
        if (limit?.kind === "wait" && attempt === 0 && limit.ms <= maxWaitMs) {
          pushSlot(name, limit.ms);
          continue;
        }
        if (limit?.kind === "wait" || limit?.kind === "rest") restImageProvider(name, Date.now() + (limit.kind === "wait" ? limit.ms : limit.ms), "busy, resting a minute");
        errors.push(message);
        break;
      }
    }
  }
  throw new AllProvidersFailedError(`No image provider could answer. ${errors.join(" | ")}`);
}
