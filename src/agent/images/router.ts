import { and, count, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { freePlan, imageChain, imageProviderConfig } from "@/lib/config";
import { assertCanGenerate } from "@/lib/plan";
import { QuotaExceededError, AllProvidersFailedError, bumpProvider, providerRequestsToday } from "../router";
import {
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
        gte(schema.generations.createdAt, start),
      ),
    );
  return Number(row?.n ?? 0);
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
  for (const name of imageChain()) {
    const built = buildImageProvider(name);
    if (!built) {
      errors.push(`${name}: not configured`);
      continue;
    }
    if ((await providerRequestsToday(`image:${name}`)) >= built.dailyLimit) {
      errors.push(`${name}: daily free limit reached`);
      continue;
    }
    const started = Date.now();
    await bumpProvider(`image:${name}`);
    try {
      const out = await built.provider.generate(req);
      await db.insert(schema.generations).values({
        workspaceId: ctx.workspaceId,
        brandId: ctx.brandId ?? null,
        subjectType: ctx.subject?.type,
        subjectId: ctx.subject?.id,
        task: "image",
        purpose: ctx.purpose,
        provider: name,
        model: built.provider.model,
        prompt: req.prompt,
        output: `${out.mime}, ${out.data.length} bytes`,
        status: "ok",
        durationMs: Date.now() - started,
      });
      return { ...out, provider: name, model: built.provider.model };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(message);
      await db.insert(schema.generations).values({
        workspaceId: ctx.workspaceId,
        brandId: ctx.brandId ?? null,
        subjectType: ctx.subject?.type,
        subjectId: ctx.subject?.id,
        task: "image",
        purpose: ctx.purpose,
        provider: name,
        model: built.provider.model,
        prompt: req.prompt,
        status: "failed",
        error: message.slice(0, 2000),
        durationMs: Date.now() - started,
      });
    }
  }
  throw new AllProvidersFailedError(`No image provider could answer. ${errors.join(" | ")}`);
}
