/*
 * All Phase 1 limits and provider settings, read from environment variables.
 * Phase 2 moves plan limits into a `plans` table and adds credits + billing.
 */

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export type ProviderDriver = "gemini" | "openai_compatible" | "fake";

export type ProviderConfig = {
  name: string;
  driver: ProviderDriver;
  apiKey?: string;
  model: string;
  baseUrl?: string;
  dailyLimit: number;
  costPer1kInputUsd: number;
  costPer1kOutputUsd: number;
};

export function freePlan() {
  return {
    maxBrands: num(process.env.AGENT_MAX_BRANDS, 4),
    maxPostsPerCampaign: num(process.env.AGENT_MAX_POSTS_PER_CAMPAIGN, 30),
    monthlyTextGenerations: num(process.env.AGENT_MONTHLY_TEXT_GENERATIONS, 600),
    monthlyImageGenerations: num(process.env.AGENT_MONTHLY_IMAGE_GENERATIONS, 200),
    // 0 (default) = no trial expiry; usage limits below still apply.
    trialDays: Math.max(0, num(process.env.AGENT_TRIAL_DAYS, 0)),
    monthlyVideos: num(process.env.AGENT_MONTHLY_VIDEOS, 30),
  };
}

export function textChain(): string[] {
  return (process.env.AGENT_TEXT_CHAIN ?? "gemini,groq")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function providerConfig(name: string): ProviderConfig | null {
  const e = process.env;
  switch (name) {
    case "gemini":
      return {
        name,
        driver: "gemini",
        apiKey: e.GEMINI_API_KEY,
        model: e.GEMINI_MODEL ?? "gemini-flash-lite-latest,gemini-flash-latest",
        baseUrl: e.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta",
        dailyLimit: num(e.GEMINI_DAILY_LIMIT, 200),
        costPer1kInputUsd: 0,
        costPer1kOutputUsd: 0,
      };
    case "groq":
      return {
        name,
        driver: "openai_compatible",
        apiKey: e.GROQ_API_KEY,
        model: e.GROQ_MODEL ?? "llama-3.3-70b-versatile",
        baseUrl: e.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
        dailyLimit: num(e.GROQ_DAILY_LIMIT, 500),
        costPer1kInputUsd: 0,
        costPer1kOutputUsd: 0,
      };
    case "openrouter":
      return {
        name,
        driver: "openai_compatible",
        apiKey: e.OPENROUTER_API_KEY,
        model: e.OPENROUTER_MODEL ?? "meta-llama/llama-3.3-70b-instruct:free",
        baseUrl: e.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
        dailyLimit: num(e.OPENROUTER_DAILY_LIMIT, 50),
        costPer1kInputUsd: 0,
        costPer1kOutputUsd: 0,
      };
    case "local":
      // Ollama / LM Studio on an office machine: no limit, no cost.
      return {
        name,
        driver: "openai_compatible",
        apiKey: e.LOCAL_LLM_API_KEY ?? "local",
        model: e.LOCAL_LLM_MODEL ?? "qwen2.5:14b",
        baseUrl: e.LOCAL_LLM_BASE_URL ?? "http://127.0.0.1:11434/v1",
        dailyLimit: num(e.LOCAL_LLM_DAILY_LIMIT, 100000),
        costPer1kInputUsd: 0,
        costPer1kOutputUsd: 0,
      };
    case "fake":
      // No API key needed: for tests and demos.
      return { name, driver: "fake", model: "fake-1", dailyLimit: 100000, costPer1kInputUsd: 0, costPer1kOutputUsd: 0 };
    default:
      return null;
  }
}

export function httpTimeoutMs(): number {
  return num(process.env.AGENT_HTTP_TIMEOUT_MS, 90_000);
}

// ---------- Image providers ----------

export type ImageProviderConfig = {
  name: string;
  driver: "cloudflare" | "huggingface" | "pollinations" | "fake";
  apiKey?: string;
  accountId?: string;
  model: string;
  dailyLimit: number;
  baseUrl?: string;
};

export function imageChain(): string[] {
  return (process.env.AGENT_IMAGE_CHAIN ?? "cloudflare,huggingface,fake")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function imageProviderConfig(name: string): ImageProviderConfig | null {
  const e = process.env;
  switch (name) {
    case "cloudflare":
      // Cloudflare Workers AI free daily allowance: https://dash.cloudflare.com -> AI -> Workers AI
      return {
        name,
        driver: "cloudflare",
        apiKey: e.CLOUDFLARE_API_TOKEN,
        accountId: e.CLOUDFLARE_ACCOUNT_ID,
        model: e.CLOUDFLARE_IMAGE_MODEL ?? "@cf/black-forest-labs/flux-1-schnell",
        dailyLimit: num(e.CLOUDFLARE_IMAGE_DAILY_LIMIT, 100),
        // Only changed by automated tests, which point it at a local stub server.
        baseUrl: e.CLOUDFLARE_BASE_URL ?? "https://api.cloudflare.com/client/v4",
      };
    case "huggingface":
      // Hugging Face Inference (free monthly credits): https://huggingface.co/settings/tokens
      return {
        name,
        driver: "huggingface",
        apiKey: e.HF_TOKEN,
        model: e.HF_IMAGE_MODEL ?? "black-forest-labs/FLUX.1-schnell",
        dailyLimit: num(e.HF_IMAGE_DAILY_LIMIT, 50),
      };
    case "pollinations":
      // No key. Fine for internal tests; check its terms before selling to customers.
      return { name, driver: "pollinations", model: e.POLLINATIONS_MODEL ?? "flux", dailyLimit: num(e.POLLINATIONS_DAILY_LIMIT, 100) };
    case "fake":
      // Always works offline: brand-colour gradient background.
      return { name, driver: "fake", model: "gradient-1", dailyLimit: 1_000_000 };
    default:
      return null;
  }
}

// ---------- Voice (text-to-speech) providers ----------

export type VoiceProviderConfig = {
  name: string;
  driver: "cloudflare" | "piper" | "silent";
  apiKey?: string;
  accountId?: string;
  model: string;
  command?: string;
  dailyLimit: number;
};

export function voiceChain(): string[] {
  return (process.env.AGENT_VOICE_CHAIN ?? "cloudflare,piper,silent")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function voiceProviderConfig(name: string): VoiceProviderConfig | null {
  const e = process.env;
  switch (name) {
    case "cloudflare":
      // Cloudflare Workers AI MeloTTS (same free allowance + token as images)
      return {
        name,
        driver: "cloudflare",
        apiKey: e.CLOUDFLARE_API_TOKEN,
        accountId: e.CLOUDFLARE_ACCOUNT_ID,
        model: e.CLOUDFLARE_TTS_MODEL ?? "@cf/myshell-ai/melotts",
        dailyLimit: num(e.CLOUDFLARE_TTS_DAILY_LIMIT, 200),
      };
    case "piper":
      // Piper: free neural voice that runs on your own machine.
      // Install: pip install piper-tts ; download a voice (.onnx + .onnx.json) and set PIPER_MODEL.
      return {
        name,
        driver: "piper",
        model: e.PIPER_MODEL ?? "",
        command: e.PIPER_COMMAND ?? "python3 -m piper",
        dailyLimit: 1_000_000,
      };
    case "silent":
      // Fallback: no voice, the reel still gets music and subtitles.
      return { name, driver: "silent", model: "silent", dailyLimit: 1_000_000 };
    default:
      return null;
  }
}

export function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("ffmpeg-static") as string;
}
