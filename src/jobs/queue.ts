import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Job } from "@/db/schema";
import { handlers } from "./handlers";

const MAX_ATTEMPTS = 3;
const g = globalThis as unknown as { __agentWorker?: boolean };

export async function enqueue(type: keyof typeof handlers, payload: Record<string, unknown>, workspaceId?: number) {
  const db = await getDb();
  const [job] = await db.insert(schema.jobs).values({ type, payload, workspaceId }).returning();
  kickWorker();
  return job;
}

/*
 * Speed: a new job used to wait for the worker's next 3-second tick. Now the worker is
 * kicked right away (once per event-loop turn), so chained steps start within milliseconds.
 * Only when the inline worker is running; tests and scripts call processJobs() themselves.
 */
const kick = globalThis as unknown as { __agentKick?: boolean };
export function kickWorker(): void {
  if (!g.__agentWorker || kick.__agentKick) return;
  kick.__agentKick = true;
  setImmediate(() => {
    kick.__agentKick = false;
    try {
      fillJobLanes();
    } catch (err) {
      console.error("[agent worker]", err);
    }
  });
}

/** Atomically claim the next due job (safe with several workers). */
async function claimNext(): Promise<Job | null> {
  const db = await getDb();
  const result = await db.execute(sql`
    UPDATE ${schema.jobs}
    SET status = 'running', attempts = attempts + 1, updated_at = now()
    WHERE id = (
      SELECT id FROM ${schema.jobs}
      WHERE status = 'queued' AND run_after <= now()
      -- Quick text work (plans, captions, articles, replies, publishing) before slow media work,
      -- so one long reel never holds up a week's writing or an article.
      ORDER BY CASE
        WHEN type IN ('post.design', 'campaign.design') THEN 1
        WHEN type = 'post.reel' THEN 2
        ELSE 0
      END, id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);
  const rows = (result as unknown as { rows: { id: number }[] }).rows;
  if (!rows?.length) return null;
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, rows[0].id));
  return job ?? null;
}

async function runJob(job: Job): Promise<void> {
  const db = await getDb();
  const handler = handlers[job.type as keyof typeof handlers];
  // Heartbeat: a long job (a reel, a poster waiting for a free AI) is never mistaken for a stuck one.
  const beat = setInterval(() => {
    void db.update(schema.jobs).set({ updatedAt: new Date() }).where(and(eq(schema.jobs.id, job.id), eq(schema.jobs.status, "running"))).catch(() => {});
  }, 60_000);
  try {
    if (!handler) throw new Error(`Unknown job type: ${job.type}`);
    await handler(job.payload);
    await db.update(schema.jobs).set({ status: "done", error: null, updatedAt: new Date() }).where(eq(schema.jobs.id, job.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const permanent = (err as { permanent?: boolean })?.permanent === true;
    const retry = !permanent && job.attempts < MAX_ATTEMPTS;
    await db
      .update(schema.jobs)
      .set({
        status: retry ? "queued" : "failed",
        error: message.slice(0, 2000),
        runAfter: new Date(Date.now() + job.attempts * 30_000),
        updatedAt: new Date(),
      })
      .where(eq(schema.jobs.id, job.id));
    if (!retry) {
      const onFail = handlers[job.type as keyof typeof handlers]?.onFinalFailure;
      await onFail?.(job.payload, message);
    }
  } finally {
    clearInterval(beat);
  }
}

/** Process due jobs until none are left (or `max` reached). Returns how many ran. */
export async function processJobs(max = 50): Promise<number> {
  let ran = 0;
  while (ran < max) {
    const job = await claimNext();
    if (!job) break;
    await runJob(job);
    ran++;
  }
  return ran;
}

/**
 * Keeps up to AGENT_JOB_LANES jobs running at the same time (default 3), so one slow job
 * (a reel, or a poster waiting for a free AI's turn) never holds up everything else.
 * Called every few seconds; it only starts lanes that are free and never waits for them.
 */
const lanes = globalThis as unknown as { __agentLanes?: number };
export function fillJobLanes(max = Math.max(1, Number(process.env.AGENT_JOB_LANES ?? 3))): void {
  lanes.__agentLanes ??= 0;
  while (lanes.__agentLanes < max) {
    lanes.__agentLanes++;
    void (async () => {
      try {
        for (let i = 0; i < 25; i++) {
          const job = await claimNext();
          if (!job) break;
          await runJob(job);
        }
      } catch (err) {
        console.error("[agent worker]", err);
      } finally {
        lanes.__agentLanes = (lanes.__agentLanes ?? 1) - 1;
      }
    })();
  }
}

export async function pendingJobCount(workspaceId: number): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.workspaceId, workspaceId), sql`${schema.jobs.status} in ('queued','running')`));
  return rows.length;
}

/** Put jobs stuck in "running" (e.g. the server stopped mid-job) back in the queue. */
export async function recoverStaleJobs(olderThanMinutes = 10, before?: Date): Promise<number> {
  const db = await getDb();
  const cutoff = before ?? new Date(Date.now() - olderThanMinutes * 60_000);
  const result = await db.execute(sql`
    UPDATE ${schema.jobs}
    SET status = 'queued', updated_at = now(), run_after = now()
    WHERE status = 'running' AND updated_at < ${cutoff.toISOString()}::timestamptz
    RETURNING id
  `);
  return ((result as unknown as { rows: unknown[] }).rows ?? []).length;
}

/**
 * Problem with the campaign's MOST RECENT job (shown on the campaign page).
 * Older failed attempts are ignored, so after a Retry the old error disappears.
 */
export async function campaignJobProblem(workspaceId: number, campaignId: number): Promise<{ error: string; attempts: number; status: string } | null> {
  const db = await getDb();
  const result = await db.execute(sql`
    SELECT error, attempts, status FROM ${schema.jobs}
    WHERE workspace_id = ${workspaceId}
      AND (payload->>'campaignId')::int = ${campaignId}
      AND type LIKE 'campaign.%'
    ORDER BY id DESC LIMIT 1
  `);
  const row = (result as unknown as { rows: { error: string | null; attempts: number; status: string }[] }).rows?.[0];
  if (!row?.error || !["queued", "failed"].includes(row.status)) return null;
  return { error: row.error, attempts: row.attempts, status: row.status };
}

/*
 * Built-in background worker for single-server mode (AGENT_INLINE_JOBS=true):
 * checks the queue every few seconds, so retries and leftover jobs always run,
 * even when nobody clicks anything.
 */
export function startInlineWorker(everyMs = 3000) {
  if (g.__agentWorker) return;
  g.__agentWorker = true;
  let busy = false;
  let first = true;
  let lastAutopilotCheck = 0;
  const startedAt = new Date();
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      // On server start, anything marked "running" was interrupted: requeue it now,
      // and remember which free AIs were already out for the day (no wasted first call).
      if (first) {
        const { restoreProviderState } = await import("@/agent/provider-state");
        await restoreProviderState().catch(() => 0);
      }
      await recoverStaleJobs(10, first ? startedAt : undefined);
      first = false;
      // Weekly autopilot: once a minute, queue the brands whose planning day has come.
      if (Date.now() - lastAutopilotCheck > 60_000) {
        lastAutopilotCheck = Date.now();
        const { queueDueAutopilots } = await import("@/agent/autopilot");
        await queueDueAutopilots();
        // Auto-approve first, so a post approved now goes out in the same minute.
        const { autoApproveReady } = await import("@/agent/auto-approve");
        await autoApproveReady();
        const { queueDuePublications } = await import("@/agent/publish");
        await queueDuePublications();
        const { healStuckWork } = await import("./heal");
        await healStuckWork();
        // Analyst: once a day per brand, read post results and update the brand's memory.
        const { queueDueAnalysts } = await import("@/agent/analyst");
        await queueDueAnalysts();
        // Community manager: every 30 minutes per brand, read new comments and draft replies.
        const { queueDueCommunity } = await import("@/agent/community");
        await queueDueCommunity();
      }
      fillJobLanes();
    } catch (err) {
      console.error("[agent worker]", err);
    } finally {
      busy = false;
    }
  }, everyMs);
}
