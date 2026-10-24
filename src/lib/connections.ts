import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildProvider } from "@/agent/router";
import { providerRequestsToday } from "@/agent/router";
import { buildImageProvider } from "@/agent/images/router";
import { buildVoiceProvider } from "@/agent/video/voice";
import { toWav, wavDurationSec } from "@/agent/video/ffmpeg";
import {
  ffmpegPath,
  imageChain,
  imageProviderConfig,
  providerConfig,
  textChain,
  voiceChain,
  voiceProviderConfig,
} from "./config";

export type Task = "text" | "image" | "voice";

/** Where to get each key and which .env.local variables it needs. */
export const PROVIDER_HELP: Record<string, { label: string; free: string; url?: string; env: string[] }> = {
  "text:gemini": { label: "Google Gemini", free: "Free tier (daily request limit)", url: "https://aistudio.google.com/apikey", env: ["GEMINI_API_KEY"] },
  "text:groq": { label: "Groq (Llama 3.3 70B)", free: "Free tier", url: "https://console.groq.com/keys", env: ["GROQ_API_KEY"] },
  "text:openrouter": { label: "OpenRouter (free models)", free: "Free models", url: "https://openrouter.ai/keys", env: ["OPENROUTER_API_KEY"] },
  "text:local": { label: "Local model (Ollama)", free: "Free, runs on your Mac", url: "https://ollama.com", env: ["LOCAL_LLM_BASE_URL", "LOCAL_LLM_MODEL"] },
  "text:fake": { label: "Demo writer", free: "Built in, sample text only", env: [] },
  "image:cloudflare": { label: "Cloudflare Workers AI (FLUX)", free: "Free daily allowance", url: "https://dash.cloudflare.com/?to=/:account/ai/workers-ai", env: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"] },
  "image:huggingface": { label: "Hugging Face (FLUX)", free: "Free monthly credits", url: "https://huggingface.co/settings/tokens", env: ["HF_TOKEN"] },
  "image:pollinations": { label: "Pollinations", free: "Free, no key (test use)", env: [] },
  "image:fake": { label: "Demo backgrounds", free: "Built in, colour gradients", env: [] },
  "voice:cloudflare": { label: "Cloudflare MeloTTS", free: "Same Cloudflare key as images", url: "https://dash.cloudflare.com/?to=/:account/ai/workers-ai", env: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"] },
  "voice:piper": { label: "Piper (offline voice)", free: "Free, runs on your server", url: "https://github.com/rhasspy/piper", env: ["PIPER_MODEL"] },
  "voice:silent": { label: "No voice", free: "Music + subtitles only", env: [] },
};

export type ConnectionRow = {
  task: Task;
  name: string;
  label: string;
  free: string;
  url?: string;
  env: string[];
  model: string;
  configured: boolean;
  usedToday: number;
  dailyLimit: number;
  order: number;
};

export async function connectionRows(): Promise<ConnectionRow[]> {
  const rows: ConnectionRow[] = [];
  const add = async (task: Task, names: string[]) => {
    for (const [order, name] of names.entries()) {
      const help = PROVIDER_HELP[`${task}:${name}`] ?? { label: name, free: "", env: [] };
      let model = "";
      let dailyLimit = 0;
      let configured = false;
      if (task === "text") {
        const c = providerConfig(name);
        model = c?.model ?? "";
        dailyLimit = c?.dailyLimit ?? 0;
        configured = Boolean(c && (c.driver === "fake" || c.apiKey));
      } else if (task === "image") {
        const c = imageProviderConfig(name);
        model = c?.model ?? "";
        dailyLimit = c?.dailyLimit ?? 0;
        configured = buildImageProvider(name) !== null;
      } else {
        const c = voiceProviderConfig(name);
        model = c?.model.split("/").pop() ?? "";
        dailyLimit = c?.dailyLimit ?? 0;
        configured = buildVoiceProvider(name) !== null;
      }
      const usedToday = await providerRequestsToday(task === "text" ? name : `${task}:${name}`);
      rows.push({ task, name, ...help, model, configured, usedToday, dailyLimit, order });
    }
  };
  await add("text", textChain());
  await add("image", imageChain());
  await add("voice", voiceChain());
  return rows;
}

export type TestResult = { ok: boolean; message: string; ms: number };

/** Calls one provider directly with a tiny request. Not counted against limits. */
export async function testConnection(task: Task, name: string): Promise<TestResult> {
  const started = Date.now();
  try {
    if (task === "text") {
      const built = buildProvider(name);
      if (!built) return { ok: false, message: "Not configured — add the key to .env.local and restart.", ms: 0 };
      const r = await built.provider.generate({ system: "You are a connection test.", prompt: "Reply with exactly: OK, connected." });
      return { ok: true, message: `Reply: "${r.text.trim().slice(0, 80)}" (${built.provider.model})`, ms: Date.now() - started };
    }
    if (task === "image") {
      const built = buildImageProvider(name);
      if (!built) return { ok: false, message: "Not configured — add the key to .env.local and restart.", ms: 0 };
      const r = await built.provider.generate({ prompt: "a small cup of masala chai on a wooden table, photo", width: 512, height: 512 });
      return { ok: true, message: `Image received: ${Math.round(r.data.length / 1024)} KB ${r.mime}`, ms: Date.now() - started };
    }
    const p = buildVoiceProvider(name);
    if (!p) return { ok: false, message: "Not configured — see the setup notes.", ms: 0 };
    const wav = await toWav(await p.speak("Hello! Your marketing agent voice is working."));
    return { ok: true, message: `Voice received: ${wavDurationSec(wav).toFixed(1)} s of audio`, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, message: (err instanceof Error ? err.message : String(err)).slice(0, 300), ms: Date.now() - started };
  }
}

const run = promisify(execFile);

export async function systemChecks() {
  let ffmpeg = "missing";
  try {
    const { stdout } = await run(ffmpegPath(), ["-version"]);
    ffmpeg = stdout.split("\n")[0].replace(/ Copyright.*/, "");
  } catch {}
  const db = (process.env.DATABASE_URL ?? "").startsWith("postgres")
    ? (process.env.DATABASE_URL ?? "").includes("supabase")
      ? "Supabase Postgres"
      : "Postgres"
    : "Built-in local database (.data/)";
  const storage = process.env.STORAGE_DRIVER === "s3" ? (process.env.S3_ENDPOINT?.includes("supabase") ? "Supabase Storage" : "S3 / R2 bucket") : "Local folder (.data/uploads)";
  return { ffmpeg, db, storage };
}
