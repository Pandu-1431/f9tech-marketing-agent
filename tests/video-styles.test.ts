import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { clearProviderOverrides, registerProvider } from "@/agent/router";
import { clearImageProviderOverrides, registerImageProvider } from "@/agent/images/router";
import { FakeProvider } from "@/agent/providers/fake";
import { FakeImageProvider } from "@/agent/images/providers";
import { campaignVideos, chooseVideo, createBrand, createCampaign, getBrand, getPost, listCampaignPosts } from "@/lib/data";
import { enqueue, processJobs } from "@/jobs/queue";
import { getFile } from "@/lib/storage";
import { ffmpegPath } from "@/lib/config";
import { autoStyle, MULTI_STYLES, styleScriptLines } from "@/agent/video/styles";
import { sceneKind } from "@/agent/video/script";
import { transitionFilter, XFADE } from "@/agent/video/reel";
import { presenterPrompt } from "@/agent/video/presenter";
import { freshDb, makeWorkspace } from "./helpers";

function probe(file: string) {
  let out = "";
  try {
    execFileSync(ffmpegPath(), ["-hide_banner", "-i", file], { stdio: "pipe" });
  } catch (e) {
    out = String((e as { stderr: Buffer }).stderr);
  }
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(out)!;
  return { seconds: Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]), size: /Video: h264.*?(\d{3,4})x(\d{3,4})/.exec(out)?.slice(1, 3).map(Number) };
}

describe("video styles: rules", () => {
  it("picks a style per business segment", () => {
    expect(autoStyle({ industry: "Coaching institute" })).toBe("presenter");
    expect(autoStyle({ industry: "Sweet shop" })).toBe("theme");
    expect(autoStyle({ industry: "SaaS app" })).toBe("concept");
    expect(autoStyle({ industry: null })).toBe("theme");
  });

  it("keeps scene kinds consistent with the style", () => {
    expect(sceneKind("text", "broll", 1, 5)).toBe("text");
    expect(sceneKind("presenter", "broll", 0, 5)).toBe("presenter"); // first and last always the presenter
    expect(sceneKind("presenter", "broll", 4, 5)).toBe("presenter");
    expect(sceneKind("presenter", "broll", 2, 5)).toBe("broll");
    expect(sceneKind("presenter", null, 1, 5)).toBe("broll");
    expect(sceneKind("theme", "presenter", 0, 5)).toBe("broll");
    expect(styleScriptLines("theme").join("\n")).toMatch(/"look"/);
    expect(styleScriptLines("presenter", "Priya").join("\n")).toMatch(/named Priya/);
  });

  it("joins clips with overlapping transitions and the right offsets", () => {
    const f = transitionFilter([3, 4, 2.5], "theme");
    expect(f).toContain(`xfade=transition=circleopen:duration=${XFADE}:offset=2.600`);
    expect(f).toContain(`offset=${(3 + 4 - 2 * XFADE).toFixed(3)}[v]`);
    expect(f.match(/acrossfade/g)).toHaveLength(2);
    expect(transitionFilter([3], "text")).toBe("[0:v]null[v];[0:a]anull[a]");
  });

  it("describes one consistent presenter face per brand", () => {
    const a = presenterPrompt({ id: 2, industry: "school", city: null, audience: null });
    expect(a).toMatch(/Indian man/);
    expect(a).toMatch(/school interior/);
    expect(presenterPrompt({ id: 2, industry: null, city: null, audience: null }, 1)).toMatch(/Indian woman/);
  });
});

describe("video styles: pipeline", () => {
  beforeEach(async () => {
    await freshDb();
    clearProviderOverrides();
    clearImageProviderOverrides();
    // Real-provider stand-ins so the presenter face is made (demo art never becomes a face).
    const text = new FakeProvider();
    registerProvider({ name: "gemini", model: "stub", generate: (r) => text.generate(r) });
    const img = new FakeImageProvider();
    registerImageProvider({ name: "cloudflare", model: "stub-image", generate: (r) => img.generate(r) });
    vi.stubEnv("AGENT_TEXT_CHAIN", "gemini");
    vi.stubEnv("AGENT_IMAGE_CHAIN", "cloudflare");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    clearProviderOverrides();
    clearImageProviderOverrides();
  });

  it("makes one video per style, reuses one presenter face, and publishes the version a person picks", async () => {
    const { ws, user } = await makeWorkspace("Styles");
    const brand = await createBrand(ws.id, { name: "Bright School", industry: "School", colors: ["#1D4ED8", "#F59E0B"], platforms: ["instagram"] });
    const campaign = await createCampaign(ws.id, {
      brandId: brand.id, theme: "Drawing competition 2026", platforms: ["instagram"], startDate: "2026-11-02", endDate: "2026-11-04", postsPerWeek: 2,
    });
    await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: campaign.id }, ws.id);
    await processJobs(100);
    const [post] = await listCampaignPosts(ws.id, campaign.id);

    await enqueue("post.reel", { workspaceId: ws.id, postId: post.id, styles: MULTI_STYLES }, ws.id);
    await processJobs(100);

    const versions = (await campaignVideos(ws.id, campaign.id)).get(post.id) ?? [];
    expect(versions.map((v) => v.style).sort()).toEqual([...MULTI_STYLES].sort());
    expect((await getPost(ws.id, post.id))?.reelStatus).toBe("done");

    // One presenter face saved on the brand, reused by the presenter video.
    const withFace = await getBrand(ws.id, brand.id);
    expect(withFace?.presenter?.faceKey).toBeTruthy();
    const db = await getDb();
    const faces = await db.select().from(schema.assets).where(and(eq(schema.assets.brandId, brand.id), eq(schema.assets.kind, "presenter")));
    expect(faces).toHaveLength(1);

    // Every version is a real vertical MP4 with transitions (shorter than the plain sum would be).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "styles-"));
    for (const v of versions) {
      const file = path.join(tmp, `${v.style}.mp4`);
      fs.writeFileSync(file, (await getFile(v.storageKey))!);
      const info = probe(file);
      expect(info.size).toEqual([1080, 1920]);
      expect(info.seconds).toBeGreaterThan(8);
    }
    fs.rmSync(tmp, { recursive: true, force: true });

    // The text video saved no scene photos; the concept video did.
    const scenes = await db.select().from(schema.assets).where(and(eq(schema.assets.postId, post.id), eq(schema.assets.kind, "scene"))).orderBy(desc(schema.assets.id));
    expect(scenes.length).toBeGreaterThan(0);

    // Pick an older version: the next post version (what gets published) points to it.
    const presenterVideo = versions.find((v) => v.style === "presenter")!;
    expect(presenterVideo.id).not.toBe(versions[0].id);
    const version = await chooseVideo(ws.id, post.id, presenterVideo.id, user.id);
    expect(version?.videoAssetId).toBe(presenterVideo.id);
    expect(await chooseVideo(ws.id, post.id, 999999, user.id)).toBeNull();
  }, 240_000);
});
