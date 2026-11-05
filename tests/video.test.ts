import { beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBrand, createCampaign, latestVideos, listCampaignPosts, listProductShots } from "@/lib/data";
import sharp from "sharp";
import { getDb, schema } from "@/db";
import { newKey, putFile } from "@/lib/storage";
import { shotLabel } from "@/lib/shots";
import { endCardFrame, productShotBackground } from "@/agent/video/cards";
import { enqueue, processJobs } from "@/jobs/queue";
import { getFile } from "@/lib/storage";
import { ffmpegPath } from "@/lib/config";
import { wavDurationSec, silentWav } from "@/agent/video/ffmpeg";
import { rawToWav } from "@/agent/video/voice";
import { freshDb, makeWorkspace } from "./helpers";

/** Reads stream info using ffmpeg itself (ffprobe is not bundled). */
function probe(file: string) {
  let out = "";
  try {
    execFileSync(ffmpegPath(), ["-hide_banner", "-i", file], { stdio: "pipe" });
  } catch (e) {
    out = String((e as { stderr: Buffer }).stderr);
  }
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(out)!;
  return {
    seconds: Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]),
    video: /Video: h264.*?(\d{3,4})x(\d{3,4})/.exec(out)?.slice(1, 3).map(Number),
    audio: /Audio: aac/.test(out),
  };
}

describe("video studio helpers", () => {
  it("measures WAV durations", () => {
    expect(wavDurationSec(silentWav(3))).toBeCloseTo(3, 2);
    expect(wavDurationSec(rawToWav(Buffer.alloc(22050 * 2), 22050))).toBeCloseTo(1, 2);
  });
});

describe("video studio pipeline", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("makes a vertical reel with sound for a post", async () => {
    const { ws } = await makeWorkspace("Vizag Sweets");
    const brand = await createBrand(ws.id, { name: "Vizag Sweets", city: "Visakhapatnam", colors: ["#E63946", "#F4A261"] });
    const campaign = await createCampaign(ws.id, {
      brandId: brand.id, theme: "Diwali sweets offer", platforms: ["instagram"],
      startDate: "2026-11-01", endDate: "2026-11-07", postsPerWeek: 3,
    });
    await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: campaign.id }, ws.id);
    await processJobs(100);

    const posts = await listCampaignPosts(ws.id, campaign.id);
    const reels = posts.filter((p) => p.format === "reel");
    expect(reels.length).toBeGreaterThan(0); // the planner marks some posts as reels
    const videos = await latestVideos(ws.id, campaign.id);
    for (const post of reels) {
      expect(post.reelStatus).toBe("done");
      expect(post.reelScript?.scenes.length).toBe(4);
      const asset = videos.get(post.id)!;
      const tmp = path.join(os.tmpdir(), `reel-test-${post.id}.mp4`);
      fs.writeFileSync(tmp, (await getFile(asset.storageKey))!);
      const info = probe(tmp);
      expect(info.video).toEqual([1080, 1920]);
      expect(info.audio).toBe(true);
      expect(info.seconds).toBeGreaterThan(8);
    }
  });

  it("shows product screenshots in a phone, ends on a logo card, and saves a cover", async () => {
    const { ws } = await makeWorkspace("Chakravyuh");
    const brand = await createBrand(ws.id, { name: "Chakravyuh", website: "https://chakravyuh.upsc.guru", colors: ["#3730a3", "#f59e0b"] });
    const shot = await sharp({ create: { width: 540, height: 1170, channels: 3, background: "#eef2ff" } }).png().toBuffer();
    const key = newKey(ws.id, "shot", "image/png");
    await putFile(key, shot, "image/png");
    const db = await getDb();
    await db.insert(schema.assets).values({ workspaceId: ws.id, brandId: brand.id, kind: "product_shot", storageKey: key, mime: "image/png", prompt: "daily plan" });
    expect(await listProductShots(ws.id, brand.id)).toHaveLength(1);

    const campaign = await createCampaign(ws.id, {
      brandId: brand.id, theme: "Prelims countdown", platforms: ["instagram"], startDate: "2026-11-01", endDate: "2026-11-07", postsPerWeek: 3,
    });
    await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: campaign.id }, ws.id);
    await processJobs(100);
    const reels = (await listCampaignPosts(ws.id, campaign.id)).filter((p) => p.format === "reel");
    expect(reels.length).toBeGreaterThan(0);
    for (const post of reels) {
      expect(post.reelStatus).toBe("done");
      expect(post.reelScript?.scenes.some((sc) => sc.shot === 1)).toBe(true); // the writer used the screenshot
      const cover = await getFile(post.reelScript!.coverKey!);
      expect((await sharp(cover!).metadata()).height).toBe(1920);
    }
  });
});

describe("reel cards", () => {
  it("draws the phone mockup and the end card at reel size", async () => {
    const shot = await sharp({ create: { width: 400, height: 860, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const bg = await productShotBackground(shot, ["#3730a3", "#f59e0b"]);
    expect(await sharp(bg).metadata()).toMatchObject({ width: 1080, height: 1920 });
    const end = await endCardFrame({ brandName: "Chakravyuh", colors: ["#3730a3"], cta: "Open the free app", website: "chakravyuh.upsc.guru" });
    expect(await sharp(end).metadata()).toMatchObject({ width: 1080, height: 1920 });
    expect(shotLabel("daily-plan_screen.PNG")).toBe("daily plan screen");
  });
});
