import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

/** Thrown when a workspace's free trial is over (Phase 2 adds paid plans). */
export class TrialEndedError extends Error {
  constructor() {
    super("Your 3-week free trial has ended. Upgrade to keep generating content.");
    this.name = "TrialEndedError";
  }
}

export type TrialInfo = { endsAt: Date; daysLeft: number; active: boolean; plan: string };

export async function trialInfo(workspaceId: number): Promise<TrialInfo> {
  const db = await getDb();
  const [ws] = await db
    .select({ trialEndsAt: schema.workspaces.trialEndsAt, plan: schema.workspaces.plan })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId));
  const endsAt = ws?.trialEndsAt ?? new Date(0);
  const msLeft = endsAt.getTime() - Date.now();
  const paid = ws?.plan && ws.plan !== "free" && ws.plan !== "trial";
  return {
    endsAt,
    daysLeft: Math.max(0, Math.ceil(msLeft / 86400000)),
    active: Boolean(paid) || msLeft > 0,
    plan: ws?.plan ?? "free",
  };
}

/** Every AI generation calls this first. */
export async function assertCanGenerate(workspaceId: number): Promise<void> {
  if (!(await trialInfo(workspaceId)).active) throw new TrialEndedError();
}
