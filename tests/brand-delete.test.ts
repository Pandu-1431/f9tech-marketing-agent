import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { createBrand, createCampaign } from "@/lib/data";
import { createLead } from "@/lib/leads";
import { enqueue } from "@/jobs/queue";
import { brandFileKeys, brandFootprint, deleteBrandForever, formatBytes } from "@/lib/brand-delete";
import { getFile, newKey, putFile } from "@/lib/storage";
import { freshDb, makeWorkspace } from "./helpers";

describe("deleting a business account", () => {
  let dir: string;
  beforeEach(async () => {
    await freshDb();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "del-"));
    vi.stubEnv("STORAGE_DRIVER", "local");
    vi.stubEnv("STORAGE_LOCAL_DIR", dir);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function brandWithStuff(wsId: number, name: string) {
    const db = await getDb();
    const brand = await createBrand(wsId, { name, colors: [], platforms: ["instagram"] });
    const campaign = await createCampaign(wsId, { brandId: brand.id, theme: "Offer", platforms: ["instagram"], startDate: "2026-11-01", endDate: "2026-11-07", postsPerWeek: 2 });
    const [post] = await db.insert(schema.posts).values({ workspaceId: wsId, campaignId: campaign.id, brandId: brand.id, platform: "instagram", format: "image", publishOn: "2026-11-02", status: "published", currentVersion: 1 }).returning();
    const poster = newKey(wsId, "poster", "image/png");
    await putFile(poster, Buffer.alloc(2048, 1), "image/png");
    await db.insert(schema.assets).values({ workspaceId: wsId, brandId: brand.id, postId: post.id, kind: "poster", storageKey: poster, mime: "image/png", bytes: 2048 });
    const logo = newKey(wsId, "logo", "image/png");
    await putFile(logo, Buffer.from("logo"), "image/png");
    const cover = newKey(wsId, "cover", "image/png");
    await putFile(cover, Buffer.from("cover"), "image/png");
    await db.update(schema.brands).set({ logoKey: logo }).where(eq(schema.brands.id, brand.id));
    await db.insert(schema.articles).values({ workspaceId: wsId, brandId: brand.id, topic: "Guide", status: "ready", coverKey: cover });
    await createLead(wsId, brand.id, { name: "Ravi", phone: "9876543210" });
    await db.insert(schema.generations).values({ workspaceId: wsId, brandId: brand.id, task: "text", purpose: "post_copy", provider: "gemini", model: "m", prompt: "secret business prompt", output: "secret caption", status: "ok" });
    await enqueue("brand.seo", { workspaceId: wsId, brandId: brand.id }, wsId);
    return { brand, poster, logo, cover };
  }

  it("shows what will go, then removes the rows and frees the files", async () => {
    const { ws } = await makeWorkspace("Owner");
    const a = await brandWithStuff(ws.id, "Sweet Shop");
    const b = await brandWithStuff(ws.id, "Other Shop");

    const f = await brandFootprint(ws.id, a.brand.id);
    expect(f).toMatchObject({ campaigns: 1, posts: 1, published: 1, files: 1, bytes: 2048, leads: 1, articles: 1 });
    expect((await brandFileKeys(ws.id, a.brand.id)).sort()).toEqual([a.poster, a.logo, a.cover].sort());

    const out = await deleteBrandForever(ws.id, a.brand.id);
    expect(out.files).toBe(3);
    for (const k of [a.poster, a.logo, a.cover]) expect(await getFile(k)).toBeNull();
    for (const k of [b.poster, b.logo, b.cover]) expect(await getFile(k)).not.toBeNull(); // the other business is untouched

    const db = await getDb();
    expect(await db.select().from(schema.brands).where(eq(schema.brands.id, a.brand.id))).toHaveLength(0);
    expect(await db.select().from(schema.posts).where(eq(schema.posts.brandId, a.brand.id))).toHaveLength(0);
    expect(await db.select().from(schema.leads).where(eq(schema.leads.brandId, a.brand.id))).toHaveLength(0);
    const jobs = await db.select().from(schema.jobs);
    expect(jobs.map((j) => (j.payload as { brandId: number }).brandId)).toEqual([b.brand.id]);
    const logs = await db.select().from(schema.generations).where(eq(schema.generations.workspaceId, ws.id));
    expect(logs).toHaveLength(2); // usage still counts toward the monthly limit…
    expect(logs.filter((g) => g.prompt === "secret business prompt")).toHaveLength(1); // …but the deleted one lost its text
    expect(formatBytes(2048)).toBe("2 KB");
  });

  it("never deletes another workspace's business or files", async () => {
    const one = await makeWorkspace("One");
    const two = await makeWorkspace("Two");
    const theirs = await brandWithStuff(two.ws.id, "Their Shop");
    expect(await deleteBrandForever(one.ws.id, theirs.brand.id)).toEqual({ files: 0 });
    expect(await getFile(theirs.poster)).not.toBeNull();
    expect(await brandFileKeys(one.ws.id, theirs.brand.id)).toEqual([]);
  });
});
