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
        model: e.GEMINI_MODEL ?? "gemini-2.5-flash",
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
