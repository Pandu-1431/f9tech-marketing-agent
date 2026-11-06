import fs from "node:fs/promises";
import { brandFonts } from "@/lib/fonts";
import path from "node:path";
import { and, count, desc, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Brand, Campaign, Post, ReelScript, ReelStyle } from "@/db/schema";
import { freePlan } from "@/lib/config";
import { assertCanGenerate } from "@/lib/plan";
import { getFile, newKey, putFile } from "@/lib/storage";
import { generateImage } from "../images/router";
import { QuotaExceededError } from "../router";
import { imagePrompt, siteLabel } from "../style";
import { captionChunks, captionFrame, renderSceneFrame, REEL_H, REEL_W, textBackground } from "./frames";
import { autoStyle, motionFor, styleImageSuffix, transitionFor } from "./styles";
import { presenterFace } from "./presenter";
import { endCardFrame, productShotBackground } from "./cards";
import { composePoster } from "../images/poster";
import { creativeSpec } from "@/lib/formats";
import { ffmpeg, tempDir, wavDurationSec } from "./ffmpeg";
import { writeReelScriptWithProvider } from "./script";
import { isDemoProvider, listProductShots, recordPostVersion, setDemoPart } from "@/lib/data";
import { speak } from "./voice";
import { mapLimit, parallelism } from "@/lib/concurrency";

/*
 * Video Studio pipeline for one post:
 *   1. script   — AI writes 4-6 scenes (voiceover, on-screen text, image prompt)
 *   2. images   — one vertical AI image per scene (image router)
 *   3. voice    — each voiceover line becomes speech (voice router: Cloudflare / Piper / silent)
 *   4. frames   — image + on-screen text + subtitles + logo + progress bar (sharp)
 *   5. video    — each scene gets a camera move (zoom / pan / presenter "talk"), its own voice,
 *                 text that slides in, and a style-specific transition to the next scene (ffmpeg xfade)
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

/** Seconds two neighbouring scenes overlap during a transition. */
export const XFADE = 0.4;

/** ffmpeg filter that joins N clips: xfade for the picture, acrossfade for the sound. Outputs [v] and [a]. */
export function transitionFilter(durations: number[], style: ReelStyle): string {
  if (durations.length === 1) return "[0:v]null[v];[0:a]anull[a]";
  const parts: string[] = [];
  let v = "[0:v]";
  let a = "[0:a]";
  let length = durations[0];
  for (let k = 1; k < durations.length; k++) {
    const last = k === durations.length - 1;
    const outV = last ? "[v]" : `[v${k}]`;
    const outA = last ? "[a]" : `[a${k}]`;
    // The end card always fades in; scenes use the style's transitions.
    const t = last ? "fade" : transitionFor(style, k - 1);
    parts.push(`${v}[${k}:v]xfade=transition=${t}:duration=${XFADE}:offset=${(length - XFADE).toFixed(3)}${outV}`);
    parts.push(`${a}[${k}:a]acrossfade=d=${XFADE}${outA}`);
    length += durations[k] - XFADE;
    v = outV;
    a = outA;
  }
  return parts.join(";");
}

export async function buildReelVideo(input: {
  workspaceId: number;
  brand: Brand;
  postId: number;
  script: ReelScript;
  /** Product screenshots (in order) that scenes can show instead of an AI photo. */
  shots?: Buffer[];
  /** Used when every image AI is out of its free limit: the post's own poster photo and the app screenshots. */
  fallbacks?: { kind: "photo" | "shot"; data: Buffer; mime: string; provider: string }[];
  /** Video style (default classic) and the brand presenter's face for presenter scenes. */
  style?: ReelStyle;
  presenter?: { face: Buffer; name: string } | null;
}): Promise<{ mp4: Buffer; durationSec: number; voiceProvider: string; demoImages: boolean; cover: Buffer | null }> {
  const { workspaceId, brand, postId, script } = input;
  const shots = input.shots ?? [];
  const style = input.style ?? script.style ?? "classic";
  const presenter = input.presenter ?? null;
  let firstBackground: Buffer | null = null;
  const dir = await tempDir();
  const logo = brand.logoKey ? await getFile(brand.logoKey) : null;
  const db = await getDb();
  let voiceProvider = "";
  let demoImages = false;

  try {
    // Each scene (image + voice + frame + clip) is prepared in parallel; order is kept.
    const sceneResults = await mapLimit(script.scenes, parallelism().image, async (scene, i) => {
      const last = i === script.scenes.length - 1;

      // 2. image: brand-colour typography, the presenter's face, a product screenshot in a phone, or an AI photo.
      const kind = scene.kind === "text" ? "text" : scene.kind === "presenter" && presenter ? "presenter" : "broll";
      const shot = scene.shot ? shots[scene.shot - 1] : undefined;
      const suffix = styleImageSuffix(style, script.look);
      let img =
        kind === "text"
          ? { data: await textBackground(brand.colors, i), mime: "image/png", provider: "typography" }
          : kind === "presenter"
            ? { data: presenter!.face, mime: "image/png", provider: "presenter" }
            : shot
              ? { data: await productShotBackground(shot, brand.colors), mime: "image/png", provider: "product_shot" }
              : await generateImage(
                  { workspaceId, brandId: brand.id, purpose: "reel_scene", subject: { type: "post", id: postId } },
                  {
                    prompt: `${imagePrompt(brand, scene.imagePrompt || scene.onScreen, "band")}${suffix ? `, ${suffix}` : ""}. Vertical 9:16 ${style === "concept" ? "illustration" : "photo"}`,
                    width: REEL_W,
                    height: REEL_H,
                    colors: brand.colors,
                    seed: postId * 10 + i,
                  },
                );
      // Every image AI out for today: prefer real material (the post's AI photo, the app screenshots) over brand art.
      if (img.provider === "brand_art" && input.fallbacks?.length) {
        const pick = input.fallbacks[i % input.fallbacks.length];
        img = pick.kind === "shot"
          ? { data: await productShotBackground(pick.data, brand.colors), mime: "image/png", provider: "product_shot" }
          : { data: pick.data, mime: pick.mime, provider: pick.provider };
      }
      if (i === 0) firstBackground = img.data;
      // Typography and the presenter face are not new AI images: only scene photos are saved.
      if (kind === "broll") {
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
          demo: isDemoProvider(img.provider),
        });
        if (isDemoProvider(img.provider)) demoImages = true;
      }

      // 3. voice
      const voice = await speak({ workspaceId, brandId: brand.id, postId }, scene.voiceover);
      voiceProvider = voice.provider;
      const wavPath = path.join(dir, `v${i}.wav`);
      await fs.writeFile(wavPath, voice.wav);
      const voiceSec = wavDurationSec(voice.wav);
      const dur = Math.max(2.5, voiceSec + 0.5);
      // Animated captions (a few words at a time, in time with the voice) on every scene except the
      // call to action and text-only scenes, which already show their words big.
      const live = !last && kind !== "text";

      // 4. frame
      const frame = await renderSceneFrame({
        background: img.data,
        onScreen: scene.onScreen,
        subtitle: scene.voiceover,
        brandName: [brand.name, siteLabel(brand.website) ?? brand.city].filter(Boolean).join(" · "),
        colors: brand.colors,
        logo,
        cta: last ? script.cta : null,
        sceneIndex: i,
        sceneCount: script.scenes.length,
        fonts: brandFonts(brand.fonts),
        layout: kind === "text" ? "text" : kind === "presenter" ? "presenter" : style === "concept" ? "concept" : "standard",
        label: kind === "presenter" ? presenter!.name : style === "concept" ? (scene.step ?? null) : null,
        liveCaptions: live,
      });
      const captions = live ? captionChunks(scene.voiceover, voiceSec > 0.3 ? voiceSec : dur - 0.5) : [];
      const capPaths: string[] = [];
      for (const [k, c] of captions.entries()) {
        const p = path.join(dir, `cap${i}_${k}.png`);
        await fs.writeFile(p, await captionFrame(c.text, brand.colors, brandFonts(brand.fonts)));
        capPaths.push(p);
      }
      const bgPath = path.join(dir, `b${i}.png`);
      const overlayPath = path.join(dir, `o${i}.png`);
      await fs.writeFile(bgPath, frame.background);
      await fs.writeFile(overlayPath, frame.overlay);

      // 5. scene clip: camera move + text sliding in + voice padded to the scene length.
      // Transitions between scenes are added when the clips are joined.
      const frames = Math.ceil(dur * FPS);
      const m = motionFor(style, i, kind);
      const clip = path.join(dir, `c${i}.mp4`);
      await ffmpeg([
        "-loop", "1", "-framerate", String(FPS), "-i", bgPath,
        "-i", wavPath,
        "-loop", "1", "-framerate", String(FPS), "-i", overlayPath,
        ...capPaths.flatMap((p) => ["-loop", "1", "-framerate", String(FPS), "-i", p]),
        "-filter_complex",
        `[0:v]scale=1620:2880,zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=1:s=${REEL_W}x${REEL_H}:fps=${FPS}[bg];` +
          `[2:v]format=rgba,fade=t=in:st=0.1:d=0.4:alpha=1[ov];` +
          `[bg][ov]overlay=x=0:y='if(lt(t,0.5),70*(1-t/0.5),0)':shortest=1[s0];` +
          // Each caption chunk pops in for its words, with a small rise.
          captions
            .map((c, k) => `[s${k}][${3 + k}:v]overlay=x=0:y='if(lt(t-${c.start},0.12),24*(1-(t-${c.start})/0.12),0)':enable='between(t,${c.start},${c.end})':shortest=1[s${k + 1}];`)
            .join("") +
          `[s${captions.length}]format=yuv420p[v];` +
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

    // End card: logo, name, CTA and website for the last 2.5 seconds (no AI, always on-brand).
    const endDur = 2.5;
    const endPng = path.join(dir, "end.png");
    await fs.writeFile(
      endPng,
      await endCardFrame({ brandName: brand.name, colors: brand.colors, logo, cta: script.cta, website: siteLabel(brand.website), fonts: brandFonts(brand.fonts) }),
    );
    const endClip = path.join(dir, "end.mp4");
    await ffmpeg([
      "-loop", "1", "-framerate", String(FPS), "-i", endPng,
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
      "-filter_complex", `[0:v]scale=${REEL_W}:${REEL_H},format=yuv420p[v]`,
      "-map", "[v]", "-map", "1:a",
      "-frames:v", String(Math.ceil(endDur * FPS)), "-t", String(endDur),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-r", String(FPS),
      "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
      endClip,
    ]);
    done.push({ clip: endClip, dur: endDur });
    const parts = done.map((d) => d.clip);
    const total = done.reduce((a, d) => a + d.dur, 0) - (done.length - 1) * XFADE;

    // Join scenes with the style's transitions (video xfade + audio crossfade).
    const joined = path.join(dir, "joined.mp4");
    await ffmpeg(["-i", parts[0], ...parts.slice(1).flatMap((p) => ["-i", p]), "-filter_complex", transitionFilter(done.map((d) => d.dur), style), "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-r", String(FPS), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-ar", "44100", joined]);

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
    // Cover (thumbnail): the first scene's picture with the hook as a headline.
    let cover: Buffer | null = null;
    if (firstBackground) {
      const spec = creativeSpec("instagram", "reel");
      cover = await composePoster({
        background: firstBackground,
        width: REEL_W,
        height: REEL_H,
        template: "top",
        headline: script.scenes[0]?.onScreen || script.title,
        brandName: brand.name,
        colors: brand.colors,
        fonts: brandFonts(brand.fonts),
        logo,
        footer: [brand.name, siteLabel(brand.website)].filter(Boolean).join(" · "),
        safe: spec.safe,
      });
    }
    return { mp4: await fs.readFile(out), durationSec: total, voiceProvider, demoImages, cover };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Full Video Studio run for a post: script -> reel MP4 asset. */
export async function makeReel(campaign: Campaign, brand: Brand, post: Post, requested?: ReelStyle) {
  await assertCanGenerate(post.workspaceId);
  const limit = freePlan().monthlyVideos;
  if ((await workspaceVideosThisMonth(post.workspaceId)) >= limit) {
    throw new QuotaExceededError(`Video limit reached: ${limit} videos this month.`);
  }
  const db = await getDb();
  const started = Date.now();

  const shotRows = await listProductShots(post.workspaceId, brand.id);
  const shotLabels = shotRows.map((s) => s.prompt || "app screen");
  const style: ReelStyle = requested ?? autoStyle(brand);
  // Presenter videos need the brand's face (made once, then reused). No face = scene shots only.
  const presenter = style === "presenter" ? await presenterFace(brand) : null;
  const { script, provider: scriptProvider } = await writeReelScriptWithProvider(campaign, presenter ? { ...brand, presenter: brand.presenter ?? { faceKey: "", name: presenter.name, source: "ai" } } : brand, post, shotLabels, style);
  await db
    .update(schema.posts)
    .set({ reelScript: script })
    .where(and(eq(schema.posts.workspaceId, post.workspaceId), eq(schema.posts.id, post.id)));

  const shotFiles = (await Promise.all(shotRows.map((s) => getFile(s.storageKey)))).filter((b): b is Buffer => Boolean(b));
  // Real material to fall back on when the image AIs are out for the day.
  const [bg] = await db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.workspaceId, post.workspaceId), eq(schema.assets.postId, post.id), eq(schema.assets.kind, "background"), eq(schema.assets.demo, false)))
    .orderBy(desc(schema.assets.id))
    .limit(1);
  const fallbacks: { kind: "photo" | "shot"; data: Buffer; mime: string; provider: string }[] = [];
  const bgFile = bg && bg.provider !== "brand_art" ? await getFile(bg.storageKey) : null;
  if (bgFile && bg) fallbacks.push({ kind: "photo", data: bgFile, mime: bg.mime, provider: bg.provider ?? "image" });
  for (const f of shotFiles) fallbacks.push({ kind: "shot", data: f, mime: "image/png", provider: "product_shot" });
  const video = await buildReelVideo({ workspaceId: post.workspaceId, brand, postId: post.id, script, shots: shotFiles.length === shotRows.length ? shotFiles : [], fallbacks, style, presenter });
  let coverKey: string | undefined;
  if (video.cover) {
    coverKey = newKey(post.workspaceId, "cover", "image/png");
    await putFile(coverKey, video.cover, "image/png");
    await db.insert(schema.assets).values({
      workspaceId: post.workspaceId, brandId: brand.id, postId: post.id, kind: "cover", storageKey: coverKey, mime: "image/png",
      width: REEL_W, height: REEL_H, bytes: video.cover.length, provider: "composer", demo: video.demoImages,
    });
  }
  const demoVideo = video.demoImages || isDemoProvider(scriptProvider);
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
      style,
      provider: `ffmpeg + ${video.voiceProvider} voice`,
      demo: demoVideo,
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
    model: `${style} + ${video.voiceProvider}`,
    prompt: script.title,
    output: `${video.durationSec.toFixed(1)}s, ${video.mp4.length} bytes`,
    status: "ok",
    durationMs: Date.now() - started,
  });
  await db
    .update(schema.posts)
    .set({ reelStatus: "done", reelError: null, videoChoice: null, reelScript: { ...script, voice: video.voiceProvider, durationSec: Math.round(video.durationSec), coverKey } })
    .where(and(eq(schema.posts.workspaceId, post.workspaceId), eq(schema.posts.id, post.id)));
  await setDemoPart(post.workspaceId, post.id, "video", demoVideo);
  // New video = new version; an approved post goes back to review.
  await recordPostVersion(post.workspaceId, post.id, "reel");
  return asset;
}
