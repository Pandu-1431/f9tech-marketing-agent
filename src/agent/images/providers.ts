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
};

export type ImageResult = { data: Buffer; mime: string };

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
      body: JSON.stringify({ prompt: req.prompt, steps: 4, seed: req.seed }),
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
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(req.prompt)}?width=${req.width}&height=${req.height}&nologo=true&model=${this.model}${req.seed ? `&seed=${req.seed}` : ""}`;
    const res = await fetch(url, { signal: timeout() });
    if (!res.ok) await fail(this.name, res);
    return { data: Buffer.from(await res.arrayBuffer()), mime: res.headers.get("content-type") ?? "image/jpeg" };
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
