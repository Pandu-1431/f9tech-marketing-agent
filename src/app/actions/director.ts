"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireEditor } from "@/lib/auth";
import { getBrand } from "@/lib/data";
import { nextRunAt } from "@/agent/autopilot";
import { isObjective } from "@/agent/director";
import { enqueue, processJobs } from "@/jobs/queue";

function kickJobs() {
  if (process.env.AGENT_INLINE_JOBS !== "false") after(async () => void (await processJobs(30)));
}

/**
 * Save the marketing goal, turn the weekly autopilot on (the Director runs through it) and
 * write a fresh four-week plan.
 */
export async function saveGoalAction(brandId: number, formData: FormData) {
  const { workspace } = await requireEditor();
  const brand = await getBrand(workspace.id, brandId);
  if (!brand) return;
  const objective = String(formData.get("objective") ?? "");
  const goal = {
    objective: isObjective(objective) ? objective : "awareness",
    target: String(formData.get("target") ?? "").trim().slice(0, 120),
    focus: String(formData.get("focus") ?? "").trim().slice(0, 500),
    postsPerWeek: Math.min(14, Math.max(1, Number(formData.get("postsPerWeek")) || 5)),
  } as const;
  const db = await getDb();
  await db
    .update(schema.brands)
    .set({
      marketingGoal: goal,
      autopilotEnabled: true,
      autopilotPostsPerWeek: goal.postsPerWeek,
      autopilotNextRunAt: brand.autopilotEnabled && brand.autopilotNextRunAt ? brand.autopilotNextRunAt : nextRunAt(brand),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.brands.workspaceId, workspace.id), eq(schema.brands.id, brandId)));
  await enqueue("director.plan", { workspaceId: workspace.id, brandId }, workspace.id);
  kickJobs();
  revalidatePath(`/brands/${brandId}`);
}

/** Write a new plan now (e.g. after changing the Brand Kit). */
export async function remakePlanAction(brandId: number) {
  const { workspace } = await requireEditor();
  if (!(await getBrand(workspace.id, brandId))) return;
  await enqueue("director.plan", { workspaceId: workspace.id, brandId }, workspace.id);
  kickJobs();
  revalidatePath(`/brands/${brandId}`);
}

/** Start this week's campaign from the plan right now (instead of waiting for the weekly run day). */
export async function startWeekNowAction(brandId: number) {
  const { workspace } = await requireEditor();
  if (!(await getBrand(workspace.id, brandId))) return;
  await enqueue("autopilot.run", { workspaceId: workspace.id, brandId, at: new Date().toISOString() }, workspace.id);
  kickJobs();
  revalidatePath(`/brands/${brandId}`);
}

/** Stop the Director (the plain weekly autopilot setting stays as it is). */
export async function clearGoalAction(brandId: number) {
  const { workspace } = await requireEditor();
  const db = await getDb();
  await db
    .update(schema.brands)
    .set({ marketingGoal: null, marketingPlan: null, updatedAt: sql`now()` })
    .where(and(eq(schema.brands.workspaceId, workspace.id), eq(schema.brands.id, brandId)));
  revalidatePath(`/brands/${brandId}`);
}

/** Auto-approve on/off for one business. */
export async function setAutoApproveAction(brandId: number, on: boolean) {
  const { workspace } = await requireEditor();
  const db = await getDb();
  await db.update(schema.brands).set({ autoApprove: on, updatedAt: new Date() }).where(and(eq(schema.brands.workspaceId, workspace.id), eq(schema.brands.id, brandId)));
  if (on) kickJobs();
  revalidatePath(`/brands/${brandId}`);
  revalidatePath("/dashboard");
  revalidatePath("/review");
}
