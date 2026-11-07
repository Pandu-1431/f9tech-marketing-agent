import sharp from "sharp";
import { ProviderError } from "../providers/types";
import type { ImageProvider, ImageRequest, ImageResult } from "./providers";

/*
 * Real photos and video clips from free stock libraries (Pexels, Pixabay).
 * Real people and places look human, cost nothing and never run out like the image AIs.
 * Free keys: https://www.pexels.com/api/ (PEXELS_API_KEY), https://pixabay.com/api/docs/ (PIXABAY_API_KEY).
 * Files are downloaded and kept, so posts still work if the photo is later removed from the site.
 * (Unsplash is not used: its rules require showing their hosted file, and social posts need our own copy.)
 */

export type StockHit = {
  /** "pexels:123" / "pixabay:456": never reuse one for the same business. */
  sourceId: string;
  source: "pexels" | "pixabay";
  /** "Photo: Ravi K on Pexels" */
  credit: string;
  pageUrl: string;
  fileUrl: string;
  width: number;
  height: number;
  durationSec?: number;
};

export const stockConfigured = () => Boolean(process.env.PEXELS_API_KEY || process.env.PIXABAY_API_KEY);
export const stockVideoConfigured = stockConfigured;

const STOP = new Set(
  (
    "a an the and or of in on at to for with by from into over under near beside behind between while as is are be being " +
    "this that these those its their his her our your my some very soft warm bright natural light lighting photo photograph " +
    "photorealistic realistic image picture shot close up closeup wide angle style mood background foreground scene vertical " +
    "horizontal square cinematic high quality detailed detail 4k 8k hd sharp focus bokeh depth field composition space text " +
    "empty calm copy brand look subtle colour color colours colors accents illustration render no words letters logo"
  ).split(" "),
);

/**
 * Turns an image prompt into a short stock search: the first sentence's main words.
 * "A young Indian woman studying late at night at a desk with books, warm lamp light" -> "young indian woman studying night desk"
 */
export function stockQuery(prompt: string, maxWords = 6): string {
  const first = prompt.split(/[.,;:\n(]|\s[-–—]\s/)[0] ?? prompt;
  const words = first
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));
  return Array.from(new Set(words)).slice(0, maxWords).join(" ");
}

type Orientation = "portrait" | "landscape" | "square";
export function orientationOf(width: number, height: number): Orientation {
  return height > width * 1.1 ? "portrait" : width > height * 1.1 ? "landscape" : "square";
}

const timeout = (ms = 15_000) => AbortSignal.timeout(ms);

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers, signal: timeout() });
  if (!res.ok) throw new ProviderError(`stock HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
  return (await res.json()) as T;
}

/** Top results first; the seed spreads posts over the best few; already-used ones are skipped. */
export function pick<T extends { sourceId: string }>(hits: T[], seed = 0, avoid: Iterable<string> = []): T | null {
  const used = new Set(avoid);
  const fresh = hits.filter((h) => !used.has(h.sourceId));
  if (!fresh.length) return null;
  return fresh[Math.abs(seed) % Math.min(4, fresh.length)];
}

// ---------- Photos ----------

type PexelsPhoto = { id: number; url: string; width: number; height: number; photographer: string; src: { original: string } };
type PixabayPhoto = { id: number; pageURL: string; largeImageURL: string; imageWidth: number; imageHeight: number; user: string };

async function pexelsPhotos(query: string, o: Orientation): Promise<StockHit[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  const json = await getJson<{ photos?: PexelsPhoto[] }>(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=${o}&per_page=15`,
    { authorization: key },
  );
  return (json.photos ?? []).map((p) => ({
    sourceId: `pexels:${p.id}`,
    source: "pexels" as const,
    credit: `Photo: ${p.photographer} on Pexels`,
    pageUrl: p.url,
    fileUrl: `${p.src.original}?auto=compress&cs=tinysrgb&w=1920`,
    width: p.width,
    height: p.height,
  }));
}

async function pixabayPhotos(query: string, o: Orientation): Promise<StockHit[]> {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return [];
  const orient = o === "portrait" ? "vertical" : o === "landscape" ? "horizontal" : "all";
  const json = await getJson<{ hits?: PixabayPhoto[] }>(
    `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query.slice(0, 100))}&image_type=photo&orientation=${orient}&safesearch=true&per_page=20`,
  );
  return (json.hits ?? []).map((p) => ({
    sourceId: `pixabay:${p.id}`,
    source: "pixabay" as const,
    credit: `Photo: ${p.user} on Pixabay`,
    pageUrl: p.pageURL,
    fileUrl: p.largeImageURL,
    width: p.imageWidth,
    height: p.imageHeight,
  }));
}

/** Shorter searches when the full one finds nothing ("young indian woman studying desk" -> "woman studying desk"...). */
function fallbackQueries(query: string): string[] {
  const w = query.split(" ").filter(Boolean);
  const out = [w.join(" ")];
  if (w.length > 3) out.push(w.slice(-3).join(" "));
  if (w.length > 2) out.push(w.slice(0, 2).join(" "));
  return Array.from(new Set(out.filter(Boolean)));
}

export async function findStockPhoto(query: string, width: number, height: number, seed = 0, avoid: Iterable<string> = []): Promise<StockHit | null> {
  const o = orientationOf(width, height);
  const avoidList = [...avoid];
  for (const q of fallbackQueries(query)) {
    for (const search of [pexelsPhotos, pixabayPhotos]) {
      const hit = pick(await search(q, o).catch(() => []), seed, avoidList);
      if (hit) return hit;
    }
  }
  return null;
}

async function download(url: string, maxBytes: number): Promise<{ data: Buffer; mime: string }> {
  const res = await fetch(url, { signal: timeout(60_000) });
  if (!res.ok) throw new ProviderError(`stock download HTTP ${res.status}`, res.status);
  const size = Number(res.headers.get("content-length") ?? 0);
  if (size > maxBytes) throw new ProviderError("stock file too large");
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > maxBytes) throw new ProviderError("stock file too large");
  return { data, mime: res.headers.get("content-type") ?? "application/octet-stream" };
}

/**
 * Image-router provider "stock": finds a real photo for the prompt (or req.query) and crops it
 * to the poster size. Throws when nothing fits, so the router moves on to the image AIs.
 */
export class StockImageProvider implements ImageProvider {
  readonly name = "stock";
  readonly model = "pexels+pixabay";
  async generate(req: ImageRequest): Promise<ImageResult> {
    if (!stockConfigured()) throw new ProviderError("stock: no Pexels or Pixabay key");
    const query = req.query?.trim() || stockQuery(req.prompt);
    if (!query) throw new ProviderError("stock: nothing to search for");
    const hit = await findStockPhoto(query, req.width, req.height, req.seed ?? 0, req.avoid ?? []);
    if (!hit) throw new ProviderError(`stock: no photo found for "${query}"`);
    const file = await download(hit.fileUrl, 25_000_000);
    const data = await sharp(file.data).rotate().resize(req.width, req.height, { fit: "cover", position: "attention" }).jpeg({ quality: 88 }).toBuffer();
    return { data, mime: "image/jpeg", source: hit.source, sourceId: hit.sourceId, credit: hit.credit };
  }
}

// ---------- Video clips ----------

type PexelsVideo = {
  id: number;
  url: string;
  duration: number;
  user: { name: string };
  video_files: { quality: string | null; file_type: string; width: number | null; height: number | null; link: string }[];
};
type PixabayVideoFile = { url: string; width: number; height: number; size: number };
type PixabayVideo = { id: number; pageURL: string; duration: number; user: string; videos: Record<"large" | "medium" | "small" | "tiny", PixabayVideoFile | undefined> };

/** The file closest to 1080 wide that is still HD (no 4K downloads, no blurry ones). */
export function bestPexelsFile(files: PexelsVideo["video_files"]): PexelsVideo["video_files"][number] | null {
  const mp4 = files.filter((f) => f.file_type === "video/mp4" && f.width && f.height);
  const short = (f: (typeof mp4)[number]) => Math.min(f.width!, f.height!);
  const ok = mp4.filter((f) => short(f) >= 540 && short(f) <= 1440);
  const pool = ok.length ? ok : mp4;
  return pool.sort((a, b) => Math.abs(short(a) - 1080) - Math.abs(short(b) - 1080))[0] ?? null;
}

async function pexelsVideos(query: string, o: Orientation, minSec: number): Promise<StockHit[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  const json = await getJson<{ videos?: PexelsVideo[] }>(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${o}&per_page=15`,
    { authorization: key },
  );
  const out: StockHit[] = [];
  for (const v of json.videos ?? []) {
    if (v.duration < minSec) continue;
    const f = bestPexelsFile(v.video_files);
    if (!f) continue;
    out.push({ sourceId: `pexels-video:${v.id}`, source: "pexels", credit: `Video: ${v.user.name} on Pexels`, pageUrl: v.url, fileUrl: f.link, width: f.width!, height: f.height!, durationSec: v.duration });
  }
  return out;
}

async function pixabayVideos(query: string, o: Orientation, minSec: number): Promise<StockHit[]> {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return [];
  const json = await getJson<{ hits?: PixabayVideo[] }>(
    `https://pixabay.com/api/videos/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query.slice(0, 100))}&safesearch=true&per_page=20`,
  );
  const out: StockHit[] = [];
  for (const v of json.hits ?? []) {
    if (v.duration < minSec) continue;
    const f = [v.videos.medium, v.videos.large, v.videos.small].find((x) => x?.url && x.size < 40_000_000);
    if (!f) continue;
    out.push({ sourceId: `pixabay-video:${v.id}`, source: "pixabay", credit: `Video: ${v.user} on Pixabay`, pageUrl: v.pageURL, fileUrl: f.url, width: f.width, height: f.height, durationSec: v.duration });
  }
  // Pixabay cannot filter by shape: put the ones that already fit the frame first.
  return out.sort((a, b) => Number(orientationOf(b.width, b.height) === o) - Number(orientationOf(a.width, a.height) === o));
}

/** A real video clip (MP4) at least minSec long for a reel scene, or null when none fits. */
export async function findStockVideo(
  query: string,
  opts: { width: number; height: number; minSec: number; seed?: number; avoid?: Iterable<string> },
): Promise<(StockHit & { data: Buffer }) | null> {
  if (!stockVideoConfigured() || !query.trim()) return null;
  const o = orientationOf(opts.width, opts.height);
  const avoid = [...(opts.avoid ?? [])];
  for (const q of fallbackQueries(query)) {
    for (const search of [pexelsVideos, pixabayVideos]) {
      const hit = pick(await search(q, o, opts.minSec).catch(() => []), opts.seed ?? 0, avoid);
      if (!hit) continue;
      try {
        const file = await download(hit.fileUrl, 60_000_000);
        return { ...hit, data: file.data };
      } catch {
        avoid.push(hit.sourceId);
      }
    }
  }
  return null;
}
