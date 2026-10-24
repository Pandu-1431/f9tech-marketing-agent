import { spawn } from "node:child_process";
import { getDb, schema } from "@/db";
import { httpTimeoutMs, voiceChain, voiceProviderConfig, type VoiceProviderConfig } from "@/lib/config";
import { ProviderError } from "../providers/types";
import { AllProvidersFailedError, bumpProvider, providerRequestsToday } from "../router";
import { toWav, wavDurationSec, silentWav } from "./ffmpeg";

/*
 * Voice router: turns a line of voiceover into a WAV file.
 * Tries AGENT_VOICE_CHAIN in order (cloudflare -> piper -> silent) and logs each call.
 */

export type VoiceResult = { wav: Buffer; durationSec: number; provider: string; model: string };

export interface VoiceProvider {
  readonly name: string;
  readonly model: string;
  speak(text: string): Promise<Buffer>; // any audio format ffmpeg can read
}

class CloudflareVoice implements VoiceProvider {
  readonly name: string;
  readonly model: string;
  constructor(private cfg: VoiceProviderConfig) {
    this.name = cfg.name;
    this.model = cfg.model;
  }
  async speak(text: string): Promise<Buffer> {
    if (!this.cfg.apiKey || !this.cfg.accountId) throw new ProviderError("cloudflare voice: missing token or account id");
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${this.cfg.accountId}/ai/run/${this.model}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.cfg.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt: text, lang: "en" }),
      signal: AbortSignal.timeout(httpTimeoutMs()),
    });
    if (!res.ok) throw new ProviderError(`cloudflare voice HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
    const type = res.headers.get("content-type") ?? "";
    if (type.startsWith("audio/")) return Buffer.from(await res.arrayBuffer());
    const json = (await res.json()) as { result?: { audio?: string }; audio?: string };
    const b64 = json.result?.audio ?? json.audio;
    if (!b64) throw new ProviderError("cloudflare voice: no audio in response");
    return Buffer.from(b64, "base64");
  }
}

class PiperVoice implements VoiceProvider {
  readonly name: string;
  readonly model: string;
  constructor(private cfg: VoiceProviderConfig) {
    this.name = cfg.name;
    this.model = cfg.model.split("/").pop() ?? "piper";
  }
  speak(text: string): Promise<Buffer> {
    if (!this.cfg.model) return Promise.reject(new ProviderError("piper: set PIPER_MODEL to a voice .onnx file"));
    const [cmd, ...pre] = (this.cfg.command ?? "python3 -m piper").split(" ");
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, [...pre, "-m", this.cfg.model, "--output-raw"], { stdio: ["pipe", "pipe", "pipe"] });
      const out: Buffer[] = [];
      let err = "";
      child.stdout.on("data", (d) => out.push(d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => reject(new ProviderError(`piper: ${e.message}`)));
      child.on("close", (code) => {
        if (code !== 0 || out.length === 0) return reject(new ProviderError(`piper exited ${code}: ${err.slice(-300)}`));
        // Raw 16-bit mono PCM at the voice's sample rate -> wrap as WAV.
        resolve(rawToWav(Buffer.concat(out), piperRate(this.cfg.model)));
      });
      child.stdin.end(text);
    });
  }
}

class SilentVoice implements VoiceProvider {
  readonly name = "silent";
  readonly model = "silent";
  async speak(text: string): Promise<Buffer> {
    // About 2.6 words per second of reading time.
    const words = text.trim().split(/\s+/).length;
    return silentWav(Math.max(2, words / 2.6));
  }
}

function piperRate(modelPath: string): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg = require(/*turbopackIgnore: true*/ `${modelPath}.json`) as { audio?: { sample_rate?: number } };
    return cfg.audio?.sample_rate ?? 22050;
  } catch {
    return 22050;
  }
}

export function rawToWav(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const overrides = new Map<string, VoiceProvider>();
export function registerVoiceProvider(p: VoiceProvider) {
  overrides.set(p.name, p);
}
export function clearVoiceProviderOverrides() {
  overrides.clear();
}

export function buildVoiceProvider(name: string): VoiceProvider | null {
  const o = overrides.get(name);
  if (o) return o;
  const cfg = voiceProviderConfig(name);
  if (!cfg) return null;
  if (cfg.driver === "cloudflare") return cfg.apiKey && cfg.accountId ? new CloudflareVoice(cfg) : null;
  if (cfg.driver === "piper") return cfg.model ? new PiperVoice(cfg) : null;
  return new SilentVoice();
}

export async function speak(ctx: { workspaceId: number; brandId?: number | null; postId?: number }, text: string): Promise<VoiceResult> {
  const db = await getDb();
  const errors: string[] = [];
  for (const name of voiceChain()) {
    const provider = buildVoiceProvider(name);
    const cfg = voiceProviderConfig(name);
    if (!provider) {
      errors.push(`${name}: not configured`);
      continue;
    }
    if ((await providerRequestsToday(`voice:${name}`)) >= (cfg?.dailyLimit ?? 1_000_000)) {
      errors.push(`${name}: daily free limit reached`);
      continue;
    }
    const started = Date.now();
    await bumpProvider(`voice:${name}`);
    try {
      const wav = await toWav(await provider.speak(text));
      const durationSec = wavDurationSec(wav);
      await db.insert(schema.generations).values({
        workspaceId: ctx.workspaceId,
        brandId: ctx.brandId ?? null,
        subjectType: ctx.postId ? "post" : undefined,
        subjectId: ctx.postId,
        task: "voice",
        purpose: "reel_voiceover",
        provider: name,
        model: provider.model,
        prompt: text,
        output: `${durationSec.toFixed(1)}s audio`,
        status: "ok",
        durationMs: Date.now() - started,
      });
      return { wav, durationSec, provider: name, model: provider.model };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(message);
      await db.insert(schema.generations).values({
        workspaceId: ctx.workspaceId,
        brandId: ctx.brandId ?? null,
        task: "voice",
        purpose: "reel_voiceover",
        provider: name,
        model: provider.model,
        prompt: text,
        status: "failed",
        error: message.slice(0, 2000),
        durationMs: Date.now() - started,
      });
    }
  }
  throw new AllProvidersFailedError(`No voice provider could answer. ${errors.join(" | ")}`);
}
