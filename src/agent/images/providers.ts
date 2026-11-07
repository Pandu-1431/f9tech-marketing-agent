import sharp from "sharp";
import { httpTimeoutMs, type ImageProviderConfig } from "@/lib/config";
import { ProviderError } from "../providers/types";

export type ImageRequest = {
  prompt: string;
  width: number;
  height: number;
  /** Brand colours, used by the offline provider. */
  colors?: string[];
  seed?: number;
  /** Real-photo search words (default: taken from the prompt). */
  query?: string;
  /** Real photos this business already used ("pexels:123"): never picked again. */
  avoid?: string[];
};

export type ImageResult = {
  data: Buffer;
  mime: string;
  /** Real photos: where it came from ("pexels"), its id and the credit line. */
  source?: string;
  sourceId?: string;
  credit?: string;
};

export interface ImageProvider {
  readonly name: string;
  readonly model: string;
  generate(req: ImageRequest): Promise<ImageResult>;
}

const timeout = () => AbortSignal.timeout(httpTimeoutMs());

async function fail(name: string, res: Response): Promise<never> {
  const detail = (await res.text()).slice(0, 300);
  throw new ProviderError(`${name} HTTP ${res.status}: ${detail}`, res.status);
}

/** Cloudflare Workers AI (FLUX schnell). Returns base64 JPEG. */
export class CloudflareImageProvider implements ImageProvider {
  readonly name: string;
  readonly model: string;
  constructor(private cfg: ImageProviderConfig) {
    this.name = cfg.name;
    this.model = cfg.model;
  }
  async generate(req: ImageRequest): Promise<ImageResult> {
    if (!this.cfg.apiKey || !this.cfg.accountId) throw new ProviderError("cloudflare: missing token or account id");
    const res = await fetch(`${this.cfg.baseUrl ?? "https://api.cloudflare.com/client/v4"}/accounts/${this.cfg.accountId}/ai/run/${this.model}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.cfg.apiKey}`, "content-type": "application/json" },
      // FLUX schnell accepts only { prompt, steps }. Any extra field (e.g. "seed") is refused with HTTP 400,
      // which silently sent every image to the demo generator (Nov 2026 fix).
      body: JSON.stringify({ prompt: req.prompt, steps: 4 }),
      signal: timeout(),
    });
    if (!res.ok) await fail(this.name, res);
    const json = (await res.json()) as { result?: { image?: string } };
    if (!json.result?.image) throw new ProviderError("cloudflare: no image in response");
    return { data: Buffer.from(json.result.image, "base64"), mime: "image/jpeg" };
  }
}

/** Hugging Face Inference API. Returns raw image bytes. */
export class HuggingFaceImageProvider implements ImageProvider {
  readonly name: string;
  readonly model: string;
  constructor(private cfg: ImageProviderConfig) {
    this.name = cfg.name;
    this.model = cfg.model;
  }
  async generate(req: ImageRequest): Promise<ImageResult> {
    if (!this.cfg.apiKey) throw new ProviderError("huggingface: missing token");
    const res = await fetch(`https://router.huggingface.co/hf-inference/models/${this.model}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.cfg.apiKey}`, "content-type": "application/json", accept: "image/png" },
      body: JSON.stringify({ inputs: req.prompt, parameters: { width: req.width, height: req.height } }),
      signal: timeout(),
    });
    if (!res.ok) await fail(this.name, res);
    return { data: Buffer.from(await res.arrayBuffer()), mime: res.headers.get("content-type") ?? "image/png" };
  }
}

/** Pollinations (no key). */
export class PollinationsImageProvider implements ImageProvider {
  readonly name: string;
  readonly model: string;
  constructor(cfg: ImageProviderConfig) {
    this.name = cfg.name;
    this.model = cfg.model;
  }
  async generate(req: ImageRequest): Promise<ImageResult> {
    // Free (no token) images carry a small "pollinations.ai" mark in the bottom-right corner:
    // ask for a slightly taller image and cut that strip off.
    const extra = Math.round(req.height * 0.07);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(req.prompt)}?width=${req.width}&height=${req.height + extra}&nologo=true&model=${this.model}${req.seed ? `&seed=${req.seed}` : ""}`;
    // A free Pollinations token (https://auth.pollinations.ai) lifts the speed limit a lot.
    const token = process.env.POLLINATIONS_TOKEN;
    const res = await fetch(url, { signal: timeout(), headers: token ? { authorization: `Bearer ${token}` } : undefined });
    if (!res.ok) await fail(this.name, res);
    const raw = Buffer.from(await res.arrayBuffer());
    try {
      const img = sharp(raw);
      const meta = await img.metadata();
      const w = meta.width ?? req.width;
      const h = meta.height ?? req.height + extra;
      const keep = Math.max(1, Math.round(h * (req.height / (req.height + extra))));
      const data = await img.extract({ left: 0, top: 0, width: w, height: Math.min(h, keep) }).resize(req.width, req.height, { fit: "cover" }).png().toBuffer();
      return { data, mime: "image/png" };
    } catch {
      return { data: raw, mime: res.headers.get("content-type") ?? "image/jpeg" };
    }
  }
}

/** Offline: a soft brand-colour gradient with shapes. Always available. */
export class FakeImageProvider implements ImageProvider {
  readonly name = "fake";
  readonly model = "gradient-1";
  async generate(req: ImageRequest): Promise<ImageResult> {
    const [c1, c2, c3] = [...(req.colors ?? []), "#4F46E5", "#EC4899", "#F59E0B"].filter((c) => /^#[0-9a-f]{3,8}$/i.test(c));
    const { width: w, height: h } = req;
    const seed = req.seed ?? 1;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <circle cx="${(w * (0.2 + (seed % 5) * 0.12)).toFixed(0)}" cy="${(h * 0.3).toFixed(0)}" r="${(w * 0.28).toFixed(0)}" fill="${c3}" fill-opacity="0.35"/>
      <circle cx="${(w * 0.85).toFixed(0)}" cy="${(h * (0.15 + (seed % 3) * 0.1)).toFixed(0)}" r="${(w * 0.16).toFixed(0)}" fill="#ffffff" fill-opacity="0.18"/>
      <circle cx="${(w * 0.1).toFixed(0)}" cy="${(h * 0.9).toFixed(0)}" r="${(w * 0.22).toFixed(0)}" fill="#ffffff" fill-opacity="0.12"/>
    </svg>`;
    return { data: await sharp(Buffer.from(svg)).png().toBuffer(), mime: "image/png" };
  }
}

/** Small deterministic random numbers, so the same post always gets the same art. */
function rng(seed: number) {
  let x = (seed * 9301 + 49297) % 233280 || 1;
  return () => {
    x = (x * 9301 + 49297) % 233280;
    return x / 233280;
  };
}

function shade(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [16, 8, 0].map((s) => (n >> s) & 255).map((c) => Math.round(t < 0 ? c * (1 + t) : c + (255 - c) * t));
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Brand art: a designed, on-brand background made locally (free, instant, never runs out).
 * Used when every image AI is out of its free limit, so a poster or reel is never blocked.
 * Rich gradient, soft light, a rangoli-style dot mandala and flowing lines in the brand colours.
 * It is real design (like a Canva background), not a placeholder, so it can be approved.
 */
export class BrandArtImageProvider implements ImageProvider {
  readonly name = "brand_art";
  readonly model = "brand-art-1";
  async generate(req: ImageRequest): Promise<ImageResult> {
    const cols = (req.colors ?? []).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
    const primary = cols[0] ?? "#4F46E5";
    const accent = cols[1] ?? "#F59E0B";
    const third = cols[2] ?? shade(accent, 0.35);
    const { width: w, height: h } = req;
    const r = rng(req.seed ?? 7);
    const variant = (req.seed ?? 0) % 3;
    const cx = w * (variant === 0 ? 0.78 : variant === 1 ? 0.22 : 0.5);
    const cy = h * (variant === 2 ? 0.3 : 0.28);
    const R = Math.min(w, h) * 0.42;
    // Rangoli-style mandala: rings of dots and petals.
    let mandala = "";
    for (let ring = 1; ring <= 6; ring++) {
      const n = 8 + ring * 6;
      const rr = (R * ring) / 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + ring * 0.2;
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        mandala += ring % 2
          ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(2 + ring * 0.9).toFixed(1)}" fill="#ffffff" fill-opacity="${(0.32 - ring * 0.03).toFixed(2)}"/>`
          : `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(4 + ring * 2).toFixed(1)}" ry="${(1.6 + ring * 0.6).toFixed(1)}" transform="rotate(${((a * 180) / Math.PI).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${accent}" fill-opacity="0.45"/>`;
      }
      mandala += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rr.toFixed(1)}" fill="none" stroke="#ffffff" stroke-opacity="0.10" stroke-width="${ring % 2 ? 1.5 : 3}"/>`;
    }
    // Flowing ribbons.
    let ribbons = "";
    for (let i = 0; i < 4; i++) {
      const y0 = h * (0.55 + i * 0.09 + r() * 0.04);
      ribbons += `<path d="M ${-50} ${y0.toFixed(0)} C ${(w * 0.3).toFixed(0)} ${(y0 - h * 0.12).toFixed(0)}, ${(w * 0.6).toFixed(0)} ${(y0 + h * 0.12).toFixed(0)}, ${w + 50} ${(y0 - h * 0.04).toFixed(0)}" fill="none" stroke="${i % 2 ? accent : "#ffffff"}" stroke-opacity="${i % 2 ? 0.28 : 0.12}" stroke-width="${(w * (0.006 + i * 0.003)).toFixed(1)}"/>`;
    }
    // Sparkles.
    let sparkles = "";
    for (let i = 0; i < 26; i++) {
      sparkles += `<circle cx="${(r() * w).toFixed(0)}" cy="${(r() * h).toFixed(0)}" r="${(1 + r() * 3).toFixed(1)}" fill="#ffffff" fill-opacity="${(0.15 + r() * 0.4).toFixed(2)}"/>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(primary, 0.12)}"/><stop offset="0.55" stop-color="${primary}"/><stop offset="1" stop-color="${shade(primary, -0.55)}"/></linearGradient>
        <radialGradient id="glow" cx="${(cx / w).toFixed(2)}" cy="${(cy / h).toFixed(2)}" r="0.6"><stop offset="0" stop-color="${accent}" stop-opacity="0.55"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
        <radialGradient id="glow2" cx="0.1" cy="0.95" r="0.55"><stop offset="0" stop-color="${third}" stop-opacity="0.45"/><stop offset="1" stop-color="${third}" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
      <rect width="100%" height="100%" fill="url(#glow)"/>
      <rect width="100%" height="100%" fill="url(#glow2)"/>
      ${ribbons}${mandala}${sparkles}
    </svg>`;
    return { data: await sharp(Buffer.from(svg)).png().toBuffer(), mime: "image/png" };
  }
}
