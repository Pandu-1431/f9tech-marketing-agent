/*
 * Background worker: `npm run worker`.
 * Picks up queued jobs (campaign planning, copywriting) and runs them.
 * In development the web app also runs jobs right after a request
 * (AGENT_INLINE_JOBS=true), so this worker is optional locally.
 */
import "dotenv/config";
import { processJobs } from "../src/jobs/queue";

const IDLE_MS = Number(process.env.WORKER_IDLE_MS ?? 3000);
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
  while (!stopping) {
    try {
      const ran = await processJobs(20);
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
