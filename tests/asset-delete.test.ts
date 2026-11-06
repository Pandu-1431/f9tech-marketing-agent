import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { createBrand, createCampaign, getBrand } from "@/lib/data";
import { enqueue } from "@/jobs/queue";
import { assetsInUse, deleteAssets, deleteCampaign } from "@/lib/asset-delete";
import { getFile, newKey, putFile } from "@/lib/storage";
import { freshDb, makeWorkspace } from "./helpers";

describe("deleting media and campaigns", () => {
  let dir: string;
  beforeEach(async () => {
    await freshDb();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "assets-"));
    vi.stubEnv("STORAGE_DRIVER", "local");
    vi.stubEnv("STORAGE_LOCAL_DIR", dir);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function setup() {
    const { ws } = await makeWorkspace("Media");
    const db = await getDb();
    const brand = await createBrand(ws.id, { name: "Shop", colors: [], platforms: ["instagram"] });
    const campaign = await createCampaign(ws.id, { brandId: brand.id, theme: "Offer", platforms: ["instagram"], startDate: "2026-11-09", endDate: "2026-11-15", postsPerWeek: 2 });
    const [post] = await db.insert(schema.posts).values({ workspaceId: ws.id, campaignId: campaign.id, brandId: brand.id, platform: "instagram", format: "image", publishOn: "2026-11-10", status: "approved", currentVersion: 1 }).returning();
    const file = async (kind: string, postId: number | null = null) => {
      const key = newKey(ws.id, kind, "image/png");
      await putFile(key, Buffer.from(kind), "image/png");
      const [a] = await db.insert(schema.assets).values({ workspaceId: ws.id, brandId: brand.id, postId, kind, storageKey: key, mime: "image/png", bytes: 10 }).returning();
      return a;
    };
    const poster = await file("poster", post.id);
    const background = await file("background", post.id);
    const logo = await file("logo");
    await db.update(schema.brands).set({ logoKey: logo.storageKey }).where(eq(schema.brands.id, brand.id));
    return { ws, db, brand, campaign, post, poster, background, logo };
  }

  it("asks first only for media a post still waiting to go out uses", async () => {
    const { ws, poster, background, logo } = await setup();
    expect([...(await assetsInUse(ws.id, [poster.id, background.id, logo.id]))]).toEqual([poster.id]);
  });

  it("deletes an AI image or a logo with its file, and the business forgets the logo", async () => {
    const { ws, brand, background, logo } = await setup();
    expect(await deleteAssets(ws.id, [background.id, logo.id])).toBe(2);
    expect(await getFile(background.storageKey)).toBeNull();
    expect(await getFile(logo.storageKey)).toBeNull();
    expect((await getBrand(ws.id, brand.id))?.logoKey).toBeNull();
    const other = await makeWorkspace("Other");
    expect(await deleteAssets(other.ws.id, [background.id])).toBe(0); // never another workspace's
  });

  it("deletes a campaign with its posts, media files and queued jobs", async () => {
    const { ws, db, campaign, post, poster, background } = await setup();
    await enqueue("post.design", { workspaceId: ws.id, postId: post.id }, ws.id);
    await enqueue("campaign.write", { workspaceId: ws.id, campaignId: campaign.id }, ws.id);
    expect(await deleteCampaign(ws.id, campaign.id)).toEqual({ posts: 1, files: 2 });
    expect(await getFile(poster.storageKey)).toBeNull();
    expect(await getFile(background.storageKey)).toBeNull();
    expect(await db.select().from(schema.posts).where(eq(schema.posts.campaignId, campaign.id))).toHaveLength(0);
    expect(await db.select().from(schema.jobs)).toHaveLength(0);
    expect(await deleteCampaign(ws.id, campaign.id)).toBeNull();
  });
});
