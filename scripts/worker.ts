/*
 * Background worker: `npm run worker`.
 * Picks up queued jobs (campaign planning, copywriting) and runs them.
 * In development the web app also runs jobs right after a request
 * (AGENT_INLINE_JOBS=true), so this worker is optional locally.
 */
import "dotenv/config";
import { processJobs } from "../src/jobs/queue";
import { queueDueAutopilots } from "../src/agent/autopilot";
import { queueDuePublications } from "../src/agent/publish";
import { queueDueAnalysts } from "../src/agent/analyst";
import { queueDueCommunity } from "../src/agent/community";
import { autoApproveReady } from "../src/agent/auto-approve";
import { restoreProviderState } from "../src/agent/provider-state";

const IDLE_MS = Number(process.env.WORKER_IDLE_MS ?? 3000);
const LANES = Math.max(1, Math.min(6, Number(process.env.AGENT_JOB_LANES ?? 3) || 3));
let stopping = false;

process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

async function main() {
  if (!(process.env.DATABASE_URL ?? "").startsWith("postgres")) {
    // The embedded database can only be opened by one process at a time.
    console.error("[worker] needs a real Postgres DATABASE_URL. With the embedded database, keep AGENT_INLINE_JOBS=true instead.");
    process.exit(1);
  }
  console.log("[worker] started");
  await restoreProviderState().catch(() => 0);
  while (!stopping) {
    try {
      await queueDueAutopilots();
      await autoApproveReady();
      await queueDuePublications();
      await queueDueAnalysts();
      await queueDueCommunity();
      // Several lanes at once (AGENT_JOB_LANES, default 3): jobs are claimed with SKIP LOCKED, so
      // lanes never take the same job, and a slow reel no longer blocks everything behind it.
      const ran = (await Promise.all(Array.from({ length: LANES }, () => processJobs(10)))).reduce((a, b) => a + b, 0);
      if (ran > 0) console.log(`[worker] ran ${ran} job(s)`);
      else await new Promise((r) => setTimeout(r, IDLE_MS));
    } catch (err) {
      console.error("[worker] error", err);
      await new Promise((r) => setTimeout(r, IDLE_MS));
    }
  }
  console.log("[worker] stopped");
  process.exit(0);
}

main();
