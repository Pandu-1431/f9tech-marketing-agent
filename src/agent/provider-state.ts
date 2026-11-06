import { gt } from "drizzle-orm";
import { getDb, schema } from "@/db";

/*
 * Free-AI rest state that survives a restart.
 * The text router and the image router keep "provider X is resting until T" in memory so
 * the next request goes straight to the backup. After `npm run dev` restarts, that memory
 * was empty, so the first call hit the exhausted provider again (one wasted call and one
 * wasted wait per provider). Now every rest is also saved here and loaded at start.
 */

export type ProviderTask = "text" | "image" | "voice";

/** Save (or extend) a rest. Fire-and-forget: never slows a generation down, never throws. */
export function persistRest(provider: string, task: ProviderTask, untilMs: number, reason = ""): void {
  if (process.env.AGENT_PROVIDER_COOLDOWN_SEC === "0") return;
  void (async () => {
    try {
      const db = await getDb();
      await db
        .insert(schema.providerState)
        .values({ provider, task, restUntil: new Date(untilMs), reason: reason.slice(0, 500), updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [schema.providerState.provider, schema.providerState.task],
          set: { restUntil: new Date(untilMs), reason: reason.slice(0, 500), updatedAt: new Date() },
        });
    } catch {
      /* best effort */
    }
  })();
}

/** Rests that are still in the future (the only ones worth restoring). */
export async function loadRests(now = new Date()): Promise<{ provider: string; task: ProviderTask; untilMs: number; reason: string }[]> {
  const db = await getDb();
  const rows = await db.select().from(schema.providerState).where(gt(schema.providerState.restUntil, now));
  return rows.map((r) => ({ provider: r.provider, task: r.task as ProviderTask, untilMs: r.restUntil.getTime(), reason: r.reason ?? "" }));
}

/** Called once when the worker starts: put the saved rests back into the routers' memory. */
export async function restoreProviderState(now = new Date()): Promise<number> {
  const rests = await loadRests(now);
  if (!rests.length) return 0;
  const [{ restProvider }, { restImageProvider }] = await Promise.all([import("./router"), import("./images/limits")]);
  for (const r of rests) {
    if (r.task === "text") restProvider(r.provider, now.getTime(), r.untilMs - now.getTime(), { persist: false });
    else restImageProvider(r.provider, r.untilMs, r.reason || "resting (restored after restart)", { persist: false });
  }
  return rests.length;
}
