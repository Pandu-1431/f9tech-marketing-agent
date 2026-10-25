import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { freePlan } from "@/lib/config";

/** Thrown when a workspace's free trial is over (only when AGENT_TRIAL_DAYS > 0). */
export class TrialEndedError extends Error {
  constructor() {
    super("Your free trial has ended. Your content is safe, but new AI generation is paused.");
    this.name = "TrialEndedError";
  }
}

/**
 * enabled = false when AGENT_TRIAL_DAYS=0 (the default): no expiry at all.
 * Monthly usage limits are separate and always apply.
 */
export type TrialInfo = { enabled: boolean; endsAt: Date | null; daysLeft: number | null; active: boolean; plan: string };

export function trialEnabled(): boolean {
  return freePlan().trialDays > 0;
}

export async function trialInfo(workspaceId: number): Promise<TrialInfo> {
  const db = await getDb();
  const [ws] = await db
    .select({ trialEndsAt: schema.workspaces.trialEndsAt, plan: schema.workspaces.plan })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId));
  const plan = ws?.plan ?? "free";
  if (!trialEnabled()) return { enabled: false, endsAt: null, daysLeft: null, active: true, plan };

  const endsAt = ws?.trialEndsAt ?? new Date(0);
  const msLeft = endsAt.getTime() - Date.now();
  const paid = plan !== "free" && plan !== "trial";
  return {
    enabled: true,
    endsAt,
    daysLeft: Math.max(0, Math.ceil(msLeft / 86400000)),
    active: paid || msLeft > 0,
    plan,
  };
}

/** Every AI generation calls this first. */
export async function assertCanGenerate(workspaceId: number): Promise<void> {
  if (!(await trialInfo(workspaceId)).active) throw new TrialEndedError();
}
