import { and, count, desc, eq, gte, isNotNull, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { freePlan, imageChain, imageProviderConfig } from "@/lib/config";
import { assertCanGenerate } from "@/lib/plan";
import { QuotaExceededError, AllProvidersFailedError, bumpProvider, providerRequestsToday } from "../router";
import { classifyLimit, imageProviderRest, nextUtcMidnight, pushSlot, restImageProvider, waitForSlot } from "./limits";
import { ProviderError } from "../providers/types";
import { StockImageProvider, stockConfigured } from "./stock";
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
    case "stock":
      return stockConfigured() ? { provider: new StockImageProvider(), dailyLimit: cfg.dailyLimit } : null;
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
        ne(schema.generations.provider, "stock"), // real photos are free
        gte(schema.generations.createdAt, start),
      ),
    );
  return Number(row?.n ?? 0);
}

export type PictureSource = "real" | "ai";

/**
 * The chain from AGENT_IMAGE_CHAIN plus a last step that always works: "brand_art"
 * (a designed on-brand background), so posters and reels are never blocked by free limits.
 * AGENT_IMAGE_FALLBACK=off turns that off.
 * Real photos ("stock", Pexels/Pixabay, skipped when no key): first when the business wants real
 * photos, otherwise right after the image AIs and before the built-in backgrounds.
 * AGENT_STOCK=off leaves them out.
 */
export function fullImageChain(prefer: PictureSource = "ai"): string[] {
  const base = imageChain().filter((n) => n !== "stock");
  const chain = process.env.AGENT_IMAGE_FALLBACK === "off" || base.includes("fake") || base.includes("brand_art") ? base : [...base, "brand_art"];
  if (process.env.AGENT_STOCK === "off") return chain;
  if (prefer === "real") return ["stock", ...chain];
  const at = chain.findIndex((n) => n === "brand_art" || n === "fake");
  return at < 0 ? [...chain, "stock"] : [...chain.slice(0, at), "stock", ...chain.slice(at)];
}

/** Real photos and clips this business already used, so the same one never shows up twice. */
export async function usedStockIds(workspaceId: number, brandId: number | null | undefined): Promise<string[]> {
  if (!brandId) return [];
  const db = await getDb();
  const rows = await db
    .select({ id: schema.assets.sourceId })
    .from(schema.assets)
    .where(and(eq(schema.assets.workspaceId, workspaceId), eq(schema.assets.brandId, brandId), isNotNull(schema.assets.sourceId)))
    .orderBy(desc(schema.assets.id))
    .limit(1000);
  return rows.map((r) => r.id!).filter(Boolean);
}

export type ImageContext = {
  workspaceId: number;
  brandId?: number | null;
  purpose: string;
  subject?: { type: string; id: number };
  /** The business's choice: real photos first (default) or AI pictures first. */
  prefer?: PictureSource;
};

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

  const chain = fullImageChain(ctx.prefer ?? "ai");
  if (chain.includes("stock") && !req.avoid && stockConfigured()) req = { ...req, avoid: await usedStockIds(ctx.workspaceId, ctx.brandId) };

  for (const name of chain) {
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
        return { ...out, provider: out.source ?? name, model: built.provider.model };
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
