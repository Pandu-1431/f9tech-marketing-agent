"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireEditor } from "@/lib/auth";
import { getBrand } from "@/lib/data";
import { FORMATS } from "@/agent/planner";
import { nextRunAt } from "@/agent/autopilot";
import { enqueue, processJobs } from "@/jobs/queue";
import { PLATFORM_LABELS } from "@/lib/platforms";

function kickJobs() {
  if (process.env.AGENT_INLINE_JOBS !== "false") after(async () => void (await processJobs(30)));
}

/** Save the brand's weekly autopilot settings. */
export async function saveAutopilotAction(brandId: number, formData: FormData) {
  const { workspace } = await requireEditor();
  const brand = await getBrand(workspace.id, brandId);
  if (!brand) return;
  const enabled = formData.get("enabled") === "on";
  const day = Math.min(6, Math.max(0, Number(formData.get("day") ?? 1) || 0));
  const perWeek = Math.min(14, Math.max(1, Number(formData.get("postsPerWeek") ?? 5) || 5));
  const platforms = formData.getAll("platforms").map(String).filter((p) => p in PLATFORM_LABELS);
  const formats = formData.getAll("formats").map(String).filter((f) => (FORMATS as readonly string[]).includes(f));
  const db = await getDb();
  await db
    .update(schema.brands)
    .set({
      autopilotEnabled: enabled,
      autopilotDay: day,
      autopilotPostsPerWeek: perWeek,
      autopilotPlatforms: platforms,
      autopilotFormats: formats,
      autopilotNextRunAt: enabled ? nextRunAt({ autopilotDay: day, timezone: brand.timezone }) : null,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.brands.workspaceId, workspace.id), eq(schema.brands.id, brandId)));
  revalidatePath(`/brands/${brandId}`);
  revalidatePath("/dashboard");
}

/** Plan this week now instead of waiting for the chosen day. */
export async function runAutopilotNowAction(brandId: number) {
  const { workspace } = await requireEditor();
  const brand = await getBrand(workspace.id, brandId);
  if (!brand) return;
  await enqueue("autopilot.run", { workspaceId: workspace.id, brandId, at: new Date().toISOString() }, workspace.id);
  kickJobs();
  revalidatePath(`/brands/${brandId}`);
  revalidatePath("/dashboard");
}
