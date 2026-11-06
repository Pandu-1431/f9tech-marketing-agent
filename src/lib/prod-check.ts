/*
 * Production readiness check: `npm run check:prod` reads the env and lists what will break on the
 * server before it breaks. Pure function (no I/O), so it is easy to test.
 *   error   = the app or a core feature will not work.
 *   warning = works, but something is missing or risky.
 */

export type CheckResult = { errors: string[]; warnings: string[]; ok: string[] };
type Env = Record<string, string | undefined>;

const has = (env: Env, k: string) => Boolean(env[k]?.trim());

export function checkProductionEnv(env: Env): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ok: string[] = [];
  const pass = (msg: string) => ok.push(msg);

  // ---- Core ----
  const secret = env.SESSION_SECRET ?? "";
  if (secret.length < 32) errors.push("SESSION_SECRET must be 32+ random characters (openssl rand -base64 32).");
  else if (/change-me|dev-only|secret123/i.test(secret)) errors.push("SESSION_SECRET looks like a placeholder; generate a random one.");
  else pass("SESSION_SECRET set");
  if (has(env, "CHANNEL_SECRET") && (env.CHANNEL_SECRET ?? "").length < 32) errors.push("CHANNEL_SECRET must be 32+ characters (or leave it empty to use SESSION_SECRET).");

  const app = env.APP_URL ?? "";
  if (!app) errors.push("APP_URL is empty: invite links, Google sign-in and Instagram/Business Profile photos need the public https address.");
  else if (!/^https:\/\//.test(app)) errors.push("APP_URL must start with https:// in production.");
  else pass(`APP_URL ${app}`);

  const db = env.DATABASE_URL ?? "";
  if (!db.startsWith("postgres")) errors.push("DATABASE_URL must be a real Postgres URL (Supabase session pooler or DigitalOcean). The embedded database is for one laptop only.");
  else {
    pass("DATABASE_URL is Postgres");
    if (/:6543\//.test(db)) warnings.push("DATABASE_URL uses port 6543 (transaction pooler). Use the session pooler (5432): migrations and the job queue need it.");
  }

  if (env.AGENT_INLINE_JOBS !== "false") errors.push('AGENT_INLINE_JOBS must be "false" on the server, with `npm run worker` running as its own process.');
  else pass("Jobs run in the separate worker");

  // ---- Storage ----
  if (env.STORAGE_DRIVER !== "s3") errors.push("STORAGE_DRIVER must be s3 (Supabase Storage or Cloudflare R2): local files vanish on redeploy and platforms cannot fetch them.");
  else {
    const missing = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_PUBLIC_URL"].filter((k) => !has(env, k) || /<.*>/.test(env[k] ?? ""));
    if (missing.length) errors.push(`S3 storage is missing: ${missing.join(", ")}.`);
    else if (!/^https:\/\//.test(env.S3_PUBLIC_URL ?? "")) errors.push("S3_PUBLIC_URL must be a public https address (Instagram and Business Profile fetch posters from it).");
    else pass("S3 storage configured");
  }

  // ---- AI ----
  const chain = (env.AGENT_TEXT_CHAIN ?? "gemini,groq").split(",").map((s) => s.trim()).filter(Boolean);
  const keyFor: Record<string, string> = { gemini: "GEMINI_API_KEY", groq: "GROQ_API_KEY", openrouter: "OPENROUTER_API_KEY" };
  if (chain.includes("fake")) errors.push("AGENT_TEXT_CHAIN contains fake (demo text). Remove it in production.");
  const usable = chain.filter((p) => (keyFor[p] ? has(env, keyFor[p]) : p === "local" && has(env, "LOCAL_LLM_BASE_URL")));
  if (!usable.length) errors.push("No text AI has a key: set GEMINI_API_KEY and/or GROQ_API_KEY.");
  else {
    pass(`Text AI: ${usable.join(", ")}`);
    if (usable.length < 2) warnings.push("Only one text AI has a key. Add a second (e.g. GROQ_API_KEY) so the team keeps working when the first hits its free limit.");
  }
  const images = (env.AGENT_IMAGE_CHAIN ?? "").split(",").map((s) => s.trim());
  const imageKeys = (images.includes("cloudflare") && has(env, "CLOUDFLARE_API_TOKEN") && has(env, "CLOUDFLARE_ACCOUNT_ID")) || (images.includes("huggingface") && has(env, "HF_TOKEN"));
  if (!imageKeys) warnings.push("No image AI key (CLOUDFLARE_* or HF_TOKEN): posters use plain brand-colour backgrounds.");
  else pass("Image AI configured");

  // ---- Google ----
  if (has(env, "GOOGLE_CLIENT_ID") !== has(env, "GOOGLE_CLIENT_SECRET")) errors.push("Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither.");
  else if (has(env, "GOOGLE_CLIENT_ID")) {
    pass("Google sign-in configured");
    if (app) warnings.push(`Add ${app.replace(/\/$/, "")}/api/oauth/google/callback as an authorized redirect URI in Google Cloud.`);
  } else warnings.push("No Google client: YouTube, Business Profile and Google Sheet connections are off.");

  // ---- Proxy ----
  const hops = Number(env.TRUSTED_PROXY_HOPS ?? "1");
  if (!Number.isInteger(hops) || hops < 1) warnings.push("TRUSTED_PROXY_HOPS should be 1 behind nginx (2 if Cloudflare proxies in front of nginx).");

  return { errors, warnings, ok };
}
