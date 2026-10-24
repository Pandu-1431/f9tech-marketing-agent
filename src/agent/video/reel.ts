import fs from "node:fs/promises";
import path from "node:path";
import { and, count, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Brand, Campaign, Post, ReelScript } from "@/db/schema";
import { freePlan } from "@/lib/config";
import { assertCanGenerate } from "@/lib/plan";
import { getFile, newKey, putFile } from "@/lib/storage";
import { generateImage } from "../images/router";
import { QuotaExceededError } from "../router";
import { renderSceneFrame, REEL_H, REEL_W } from "./frames";
import { ffmpeg, tempDir, wavDurationSec } from "./ffmpeg";
import { writeReelScript } from "./script";
import { speak } from "./voice";
import { mapLimit, parallelism } from "@/lib/concurrency";

/*
 * Video Studio pipeline for one post:
 *   1. script   — AI writes 4-6 scenes (voiceover, on-screen text, image prompt)
 *   2. images   — one vertical AI image per scene (image router)
 *   3. voice    — each voiceover line becomes speech (voice router: Cloudflare / Piper / silent)
 *   4. frames   — image + on-screen text + subtitles + logo + progress bar (sharp)
 *   5. video    — each scene gets a slow zoom, its own voice, fade transitions (ffmpeg)
 *   6. music    — a soft music bed under the voice, fade in/out
 *   7. save     — MP4 (1080x1920, H.264 + AAC) stored as a "video" asset
 */

const FPS = 30;

export async function workspaceVideosThisMonth(workspaceId: number): Promise<number> {
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
        eq(schema.generations.task, "video"),
        eq(schema.generations.status, "ok"),
        gte(schema.generations.createdAt, start),
      ),
    );
  return Number(row?.n ?? 0);
}

/** Soft background music: a user-supplied file (AGENT_MUSIC_FILE) or a generated ambient chord. */
function musicInput(totalSec: number): { args: string[]; filter: string } {
  const file = process.env.AGENT_MUSIC_FILE;
  const fadeOut = Math.max(0, totalSec - 2);
  if (file) {
    return {
      args: ["-stream_loop", "-1", "-i", file],
      filter: `[1:a]volume=0.12,afade=t=in:d=1.5,afade=t=out:st=${fadeOut}:d=2,atrim=0:${totalSec}[m]`,
    };
  }
  const tone =
    "0.5*sin(2*PI*261.63*t)*(0.6+0.4*sin(2*PI*0.1*t))+0.4*sin(2*PI*329.63*t)*(0.6+0.4*sin(2*PI*0.13*t))+0.4*sin(2*PI*392*t)*(0.6+0.4*sin(2*PI*0.07*t))+0.25*sin(2*PI*130.81*t)";
  return {
    args: ["-f", "lavfi", "-i", `aevalsrc='${tone}':s=44100:d=${totalSec}`],
    filter: `[1:a]lowpass=f=900,volume=0.05,afade=t=in:d=1.5,afade=t=out:st=${fadeOut}:d=2[m]`,
  };
}

export async function buildReelVideo(input: {
  workspaceId: number;
  brand: Brand;
  postId: number;
  script: ReelScript;
}): Promise<{ mp4: Buffer; durationSec: number; voiceProvider: string }> {
  const { workspaceId, brand, postId, script } = input;
  const dir = await tempDir();
  const logo = brand.logoKey ? await getFile(brand.logoKey) : null;
  const db = await getDb();
  let voiceProvider = "";

  try {
    // Each scene (image + voice + frame + clip) is prepared in parallel; order is kept.
    const sceneResults = await mapLimit(script.scenes, parallelism().image, async (scene, i) => {
      const last = i === script.scenes.length - 1;

      // 2. image
      const img = await generateImage(
        { workspaceId, brandId: brand.id, purpose: "reel_scene", subject: { type: "post", id: postId } },
        {
          prompt: `${scene.imagePrompt || scene.onScreen}. ${brand.colors.length ? `colour palette ${brand.colors.join(", ")}. ` : ""}vertical photo, no text, no letters, no watermark`,
          width: REEL_W,
          height: REEL_H,
          colors: brand.colors,
          seed: postId * 10 + i,
        },
      );
      const sceneKey = newKey(workspaceId, "scene", img.mime);
      await putFile(sceneKey, img.data, img.mime);
      await db.insert(schema.assets).values({
        workspaceId,
        brandId: brand.id,
        postId,
        kind: "scene",
        storageKey: sceneKey,
        mime: img.mime,
        width: REEL_W,
        height: REEL_H,
        bytes: img.data.length,
        prompt: scene.imagePrompt,
        provider: img.provider,
      });

      // 3. voice
      const voice = await speak({ workspaceId, brandId: brand.id, postId }, scene.voiceover);
      voiceProvider = voice.provider;
      const wavPath = path.join(dir, `v${i}.wav`);
      await fs.writeFile(wavPath, voice.wav);
      const dur = Math.max(2.5, wavDurationSec(voice.wav) + 0.5);

      // 4. frame
      const frame = await renderSceneFrame({
        background: img.data,
        onScreen: scene.onScreen,
        subtitle: scene.voiceover,
        brandName: [brand.name, brand.city].filter(Boolean).join(" · "),
        colors: brand.colors,
        logo,
        cta: last ? script.cta : null,
        sceneIndex: i,
        sceneCount: script.scenes.length,
      });
      const bgPath = path.join(dir, `b${i}.png`);
      const overlayPath = path.join(dir, `o${i}.png`);
      await fs.writeFile(bgPath, frame.background);
      await fs.writeFile(overlayPath, frame.overlay);

      // 5. scene clip: slow zoom + fades + voice padded to the scene length
      const frames = Math.ceil(dur * FPS);
      const zoomIn = i % 2 === 0;
      const z = zoomIn ? `min(1+0.0009*on,1.12)` : `max(1.12-0.0009*on,1)`;
      const clip = path.join(dir, `c${i}.mp4`);
      await ffmpeg([
        "-loop", "1", "-framerate", String(FPS), "-i", bgPath,
        "-i", wavPath,
        "-loop", "1", "-framerate", String(FPS), "-i", overlayPath,
        "-filter_complex",
        `[0:v]scale=1620:2880,zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${REEL_W}x${REEL_H}:fps=${FPS}[bg];` +
          `[bg][2:v]overlay=0:0:shortest=1,` +
          `fade=t=in:st=0:d=0.25,fade=t=out:st=${(dur - 0.25).toFixed(2)}:d=0.25,format=yuv420p[v];` +
          `[1:a]aresample=44100,apad=whole_dur=${dur.toFixed(2)},aformat=channel_layouts=stereo[a]`,
        "-map", "[v]", "-map", "[a]",
        "-frames:v", String(frames), "-t", dur.toFixed(2),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-r", String(FPS),
        "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
        clip,
      ]);
      return { clip, dur };
    });
    const failed = sceneResults.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    if (failed) throw failed.reason;
    const done = sceneResults.map((r) => (r as PromiseFulfilledResult<{ clip: string; dur: number }>).value);
    const parts = done.map((d) => d.clip);
    const total = done.reduce((a, d) => a + d.dur, 0);

    // Join scenes.
    const list = path.join(dir, "list.txt");
    await fs.writeFile(list, parts.map((p) => `file '${p}'`).join("\n"));
    const joined = path.join(dir, "joined.mp4");
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined]);

    // 6. music bed under the voice.
    const music = musicInput(total);
    const out = path.join(dir, "reel.mp4");
    await ffmpeg([
      "-i", joined,
      ...music.args,
      "-filter_complex", `${music.filter};[0:a][m]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]`,
      "-map", "0:v", "-map", "[a]",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
      "-movflags", "+faststart",
      out,
    ]);
    return { mp4: await fs.readFile(out), durationSec: total, voiceProvider };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Full Video Studio run for a post: script -> reel MP4 asset. */
export async function makeReel(campaign: Campaign, brand: Brand, post: Post) {
  await assertCanGenerate(post.workspaceId);
  const limit = freePlan().monthlyVideos;
  if ((await workspaceVideosThisMonth(post.workspaceId)) >= limit) {
    throw new QuotaExceededError(`Video limit reached: ${limit} videos this month.`);
  }
  const db = await getDb();
  const started = Date.now();

  const script = await writeReelScript(campaign, brand, post);
  await db.update(schema.posts).set({ reelScript: script }).where(eq(schema.posts.id, post.id));

  const video = await buildReelVideo({ workspaceId: post.workspaceId, brand, postId: post.id, script });
  const key = newKey(post.workspaceId, "video", "video/mp4");
  await putFile(key, video.mp4, "video/mp4");
  const [asset] = await db
    .insert(schema.assets)
    .values({
      workspaceId: post.workspaceId,
      brandId: brand.id,
      postId: post.id,
      kind: "video",
      storageKey: key,
      mime: "video/mp4",
      width: REEL_W,
      height: REEL_H,
      bytes: video.mp4.length,
      prompt: script.title,
      provider: `ffmpeg + ${video.voiceProvider} voice`,
    })
    .returning();
  await db.insert(schema.generations).values({
    workspaceId: post.workspaceId,
    brandId: brand.id,
    subjectType: "post",
    subjectId: post.id,
    task: "video",
    purpose: "reel",
    provider: "ffmpeg",
    model: `slideshow + ${video.voiceProvider}`,
    prompt: script.title,
    output: `${video.durationSec.toFixed(1)}s, ${video.mp4.length} bytes`,
    status: "ok",
    durationMs: Date.now() - started,
  });
  await db
    .update(schema.posts)
    .set({ reelStatus: "done", reelError: null, reelScript: { ...script, voice: video.voiceProvider, durationSec: Math.round(video.durationSec) } })
    .where(eq(schema.posts.id, post.id));
  return asset;
}
