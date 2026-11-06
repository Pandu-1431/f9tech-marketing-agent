"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireEditor } from "@/lib/auth";
import { getBrand } from "@/lib/data";
import { enqueue, processJobs } from "@/jobs/queue";
import { seoJobState } from "@/agent/seo";

/** Build (or rebuild) the brand's SEO kit in the background. */
export async function buildSeoKitAction(brandId: number) {
  const { workspace } = await requireEditor();
  if (!(await getBrand(workspace.id, brandId))) return;
  if ((await seoJobState(workspace.id, brandId)).running) return; // one at a time
  await enqueue("brand.seo", { workspaceId: workspace.id, brandId }, workspace.id);
  if (process.env.AGENT_INLINE_JOBS !== "false") after(async () => void (await processJobs(5)));
  revalidatePath(`/brands/${brandId}`);
}
