"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireEditor } from "@/lib/auth";
import { listBrands } from "@/lib/data";
import { sendCommentReply, skipComment } from "@/agent/community";
import { enqueue, processJobs } from "@/jobs/queue";

export async function sendReplyAction(commentId: number, formData: FormData) {
  const { workspace } = await requireEditor();
  await sendCommentReply(workspace.id, commentId, String(formData.get("reply") ?? "")).catch(() => null);
  revalidatePath("/inbox");
}

export async function skipCommentAction(commentId: number) {
  const { workspace } = await requireEditor();
  await skipComment(workspace.id, commentId);
  revalidatePath("/inbox");
}

/** Read comments for every business now (instead of waiting up to 30 minutes). */
export async function checkCommentsNowAction() {
  const { workspace } = await requireEditor();
  for (const b of await listBrands(workspace.id)) await enqueue("community.read", { workspaceId: workspace.id, brandId: b.id }, workspace.id);
  if (process.env.AGENT_INLINE_JOBS !== "false") after(async () => void (await processJobs(20)));
  revalidatePath("/inbox");
}
