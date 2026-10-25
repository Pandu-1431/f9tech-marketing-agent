import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

/*
 * Browser tests. They start two local servers:
 *   1. a stand-in AI server (e2e/stub-ai-server.ts) — no real AI APIs are ever called;
 *   2. the app itself, with its own throwaway database and upload folder under .data/e2e.
 * Every setting below is passed explicitly, so real keys in .env.local are never used.
 * The app runs as a production build (`next start`), so run `npm run build` first
 * (`npm run test:e2e` does both). This also avoids clashing with a `next dev` you have open.
 */

const APP_PORT = 3111;
const STUB_PORT = 4111;
const dataDir = path.join(__dirname, ".data", "e2e");

const appEnv: Record<string, string> = {
  DATABASE_URL: path.join(dataDir, `db-${Date.now()}`),
  STORAGE_DRIVER: "local",
  STORAGE_LOCAL_DIR: path.join(dataDir, "uploads"),
  SESSION_SECRET: "e2e-only-session-secret-not-for-production-0123456789",
  AGENT_INLINE_JOBS: "true",
  AGENT_TRIAL_DAYS: "0",
  // Text and images go to the local stand-in; if it "fails", the built-in demo generator answers.
  AGENT_TEXT_CHAIN: "gemini,fake",
  AGENT_IMAGE_CHAIN: "cloudflare,fake",
  AGENT_VOICE_CHAIN: "silent",
  GEMINI_API_KEY: "e2e-dummy-key",
  GEMINI_MODEL: "gemini-flash-lite-latest",
  GEMINI_BASE_URL: `http://127.0.0.1:${STUB_PORT}/v1beta`,
  CLOUDFLARE_API_TOKEN: "e2e-dummy-token",
  CLOUDFLARE_ACCOUNT_ID: "e2e-account",
  CLOUDFLARE_BASE_URL: `http://127.0.0.1:${STUB_PORT}`,
  GROQ_API_KEY: "",
  OPENROUTER_API_KEY: "",
  HF_TOKEN: "",
  // Throttling: default policy (5 per email, 20 per IP, 15 minutes).
  AUTH_MAX_FAILURES_PER_EMAIL: "5",
  AUTH_MAX_FAILURES_PER_IP: "20",
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npx tsx e2e/stub-ai-server.ts",
      url: `http://127.0.0.1:${STUB_PORT}/health`,
      env: { STUB_AI_PORT: String(STUB_PORT) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx next start -p ${APP_PORT}`,
      url: `http://localhost:${APP_PORT}/login`,
      env: appEnv,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
