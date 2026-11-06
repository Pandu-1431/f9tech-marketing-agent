import { sql } from "drizzle-orm";
import { getDb } from "@/db";

export const dynamic = "force-dynamic";

/**
 * Uptime check for the load balancer / UptimeRobot: 200 when the database answers and the job
 * queue is moving, 503 otherwise. Shows no secrets and no customer data.
 */
export async function GET() {
  const started = Date.now();
  try {
    const db = await getDb();
    const { rows } = (await db.execute(
      sql`SELECT count(*)::int AS queued, coalesce(extract(epoch FROM now() - min(run_after)), 0)::int AS oldest FROM jobs WHERE status = 'queued' AND run_after <= now()`,
    )) as unknown as { rows: { queued: number; oldest: number }[] };
    const queue = rows[0] ?? { queued: 0, oldest: 0 };
    // A job waiting over 15 minutes means the worker is down or stuck.
    const stuck = queue.oldest > 15 * 60;
    return Response.json(
      { ok: !stuck, db: "up", queue: { waiting: queue.queued, oldestSeconds: queue.oldest }, ms: Date.now() - started },
      { status: stuck ? 503 : 200, headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json({ ok: false, db: "down", ms: Date.now() - started }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
