import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Job } from "@/db/schema";
import { handlers } from "./handlers";

const MAX_ATTEMPTS = 3;

export async function enqueue(type: keyof typeof handlers, payload: Record<string, unknown>, workspaceId?: number) {
  const db = await getDb();
  const [job] = await db.insert(schema.jobs).values({ type, payload, workspaceId }).returning();
  return job;
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
      ORDER BY id
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

export async function pendingJobCount(workspaceId: number): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.workspaceId, workspaceId), sql`${schema.jobs.status} in ('queued','running')`));
  return rows.length;
}
