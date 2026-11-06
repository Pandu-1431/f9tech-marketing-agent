"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireEditor } from "@/lib/auth";
import { getBrand } from "@/lib/data";
import { forget, remember } from "@/agent/memory";
import { enqueue, processJobs } from "@/jobs/queue";

function kickJobs() {
  if (process.env.AGENT_INLINE_JOBS !== "false") after(async () => void (await processJobs(30)));
}

/** A person adds a line to the brand's memory ("Students revise at night; evening posts work"). */
export async function addMemoryAction(brandId: number, formData: FormData) {
  const { workspace } = await requireEditor();
  const brand = await getBrand(workspace.id, brandId);
  if (!brand) return;
  const text = String(formData.get("text") ?? "").trim();
  if (text.length < 4) return;
  await remember(workspace.id, brandId, { kind: "fact", topic: "note", text, source: "user" });
  revalidatePath(`/brands/${brandId}`);
}

/** Forget one line (it stays in history, prompts no longer see it). */
export async function forgetMemoryAction(brandId: number, memoryId: number) {
  const { workspace } = await requireEditor();
  await forget(workspace.id, memoryId);
  revalidatePath(`/brands/${brandId}`);
}

/** Read the post results now instead of waiting for the daily run. */
export async function runAnalystNowAction(brandId: number) {
  const { workspace } = await requireEditor();
  const brand = await getBrand(workspace.id, brandId);
  if (!brand) return;
  await enqueue("analyst.run", { workspaceId: workspace.id, brandId, at: new Date().toISOString() }, workspace.id);
  kickJobs();
  revalidatePath(`/brands/${brandId}`);
}
