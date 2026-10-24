import { and, asc, count, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { NewBrand } from "@/db/schema";
import { freePlan } from "./config";

/*
 * Data access layer. Every function takes the workspaceId and filters by it,
 * so one customer can never read or change another customer's data.
 */

export class LimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitError";
  }
}

// ---------- Brands ----------

export async function listBrands(workspaceId: number) {
  const db = await getDb();
  return db.select().from(schema.brands).where(eq(schema.brands.workspaceId, workspaceId)).orderBy(asc(schema.brands.name));
}

export async function getBrand(workspaceId: number, id: number) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.brands)
    .where(and(eq(schema.brands.workspaceId, workspaceId), eq(schema.brands.id, id)));
  return row ?? null;
}

export async function countBrands(workspaceId: number) {
  const db = await getDb();
  const [row] = await db.select({ n: count() }).from(schema.brands).where(eq(schema.brands.workspaceId, workspaceId));
  return Number(row?.n ?? 0);
}

type BrandInput = Omit<NewBrand, "id" | "workspaceId" | "createdAt" | "updatedAt">;

export async function createBrand(workspaceId: number, input: BrandInput) {
  const max = freePlan().maxBrands;
  if ((await countBrands(workspaceId)) >= max) {
    throw new LimitError(`The free plan allows ${max} business accounts per workspace.`);
  }
  const db = await getDb();
  const [row] = await db
    .insert(schema.brands)
    .values({ ...input, workspaceId })
    .returning();
  return row;
}

export async function updateBrand(workspaceId: number, id: number, input: BrandInput) {
  const db = await getDb();
  const [row] = await db
    .update(schema.brands)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(schema.brands.workspaceId, workspaceId), eq(schema.brands.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteBrand(workspaceId: number, id: number) {
  const db = await getDb();
  await db.delete(schema.brands).where(and(eq(schema.brands.workspaceId, workspaceId), eq(schema.brands.id, id)));
}

// ---------- Campaigns ----------

export async function listCampaigns(workspaceId: number) {
  const db = await getDb();
  return db
    .select({ campaign: schema.campaigns, brandName: schema.brands.name })
    .from(schema.campaigns)
    .innerJoin(schema.brands, eq(schema.brands.id, schema.campaigns.brandId))
    .where(eq(schema.campaigns.workspaceId, workspaceId))
    .orderBy(desc(schema.campaigns.createdAt));
}

export async function getCampaign(workspaceId: number, id: number) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.workspaceId, workspaceId), eq(schema.campaigns.id, id)));
  return row ?? null;
}

export async function createCampaign(
  workspaceId: number,
  input: {
    brandId: number;
    theme: string;
    goal?: string | null;
    platforms: string[];
    startDate: string;
    endDate: string;
    postsPerWeek: number;
  },
) {
  const brand = await getBrand(workspaceId, input.brandId);
  if (!brand) throw new LimitError("Brand not found in this workspace.");
  const db = await getDb();
  const [row] = await db
    .insert(schema.campaigns)
    .values({ ...input, workspaceId, status: "draft" })
    .returning();
  return row;
}

export async function setCampaignStatus(workspaceId: number, id: number, status: string, extra: { error?: string | null; strategy?: string | null } = {}) {
  const db = await getDb();
  await db
    .update(schema.campaigns)
    .set({ status, ...extra })
    .where(and(eq(schema.campaigns.workspaceId, workspaceId), eq(schema.campaigns.id, id)));
}

// ---------- Posts ----------

export async function listCampaignPosts(workspaceId: number, campaignId: number) {
  const db = await getDb();
  return db
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.campaignId, campaignId)))
    .orderBy(asc(schema.posts.publishOn), asc(schema.posts.id));
}

export async function getPost(workspaceId: number, id: number) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.id, id)));
  return row ?? null;
}

export async function updatePost(
  workspaceId: number,
  id: number,
  values: Partial<Pick<typeof schema.posts.$inferInsert, "caption" | "hashtags" | "imagePrompt" | "seoKeywords" | "status" | "reviewNote">>,
) {
  const db = await getDb();
  const [row] = await db
    .update(schema.posts)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.id, id)))
    .returning();
  return row ?? null;
}

// ---------- Dashboard ----------

export async function postStatusCounts(workspaceId: number) {
  const db = await getDb();
  const rows = await db
    .select({ status: schema.posts.status, n: count() })
    .from(schema.posts)
    .where(eq(schema.posts.workspaceId, workspaceId))
    .groupBy(schema.posts.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])) as Record<string, number>;
}

export async function recentGenerations(workspaceId: number, limit = 20) {
  const db = await getDb();
  return db
    .select({
      id: schema.generations.id,
      purpose: schema.generations.purpose,
      provider: schema.generations.provider,
      model: schema.generations.model,
      status: schema.generations.status,
      durationMs: schema.generations.durationMs,
      createdAt: schema.generations.createdAt,
    })
    .from(schema.generations)
    .where(eq(schema.generations.workspaceId, workspaceId))
    .orderBy(desc(schema.generations.createdAt))
    .limit(limit);
}
