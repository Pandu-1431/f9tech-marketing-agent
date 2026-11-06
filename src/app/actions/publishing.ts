"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireEditor } from "@/lib/auth";
import { getBrand, getPost } from "@/lib/data";
import { connectChannel, isChannelPlatform, queuePublication, removeChannel } from "@/agent/publish";
import { enqueue, processJobs } from "@/jobs/queue";

export type ChannelFormState = { error?: string; ok?: string } | undefined;

function kickJobs() {
  if (process.env.AGENT_INLINE_JOBS !== "false") after(async () => void (await processJobs(30)));
}

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Test the credentials with the platform, then save the channel (token encrypted). */
export async function connectChannelAction(brandId: number, platform: string, _prev: ChannelFormState, formData: FormData): Promise<ChannelFormState> {
  const { workspace } = await requireEditor();
  if (!(await getBrand(workspace.id, brandId)) || !isChannelPlatform(platform)) return { error: "Not found" };
  let token = field(formData, "token");
  let config: Record<string, string> =
    platform === "telegram" ? { chatId: field(formData, "chatId") } : platform === "facebook" ? { pageId: field(formData, "pageId") } : { igUserId: field(formData, "igUserId") };
  if (platform === "x") {
    const keys = { apiKey: field(formData, "apiKey"), apiSecret: field(formData, "apiSecret"), accessToken: field(formData, "accessToken"), accessSecret: field(formData, "accessSecret") };
    if (Object.values(keys).some((v) => !v)) return { error: "Fill in all four keys." };
    token = JSON.stringify(keys);
    config = {};
  } else if (platform === "linkedin") {
    config = {};
  }
  if (!token || Object.values(config).some((v) => !v)) return { error: "Fill in every field." };
  try {
    const ch = await connectChannel(workspace.id, brandId, platform, token, config);
    revalidatePath(`/brands/${brandId}`);
    return { ok: `Connected: ${ch.name}` };
  } catch (err) {
    return { error: `Could not connect: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function removeChannelAction(brandId: number, channelId: number) {
  const { workspace } = await requireEditor();
  await removeChannel(workspace.id, channelId);
  revalidatePath(`/brands/${brandId}`);
}

/** Send the approved version now instead of waiting for its scheduled time (also retries a failed send). */
export async function publishNowAction(postId: number) {
  const { workspace } = await requireEditor();
  const post = await getPost(workspace.id, postId);
  if (!post) return;
  const q = await queuePublication(workspace.id, postId);
  if (q.publicationId) {
    await enqueue("post.publish", { workspaceId: workspace.id, publicationId: q.publicationId }, workspace.id);
    kickJobs();
  }
  revalidatePath(`/campaigns/${post.campaignId}`);
}

/** Rewrite the brand's Google Sheet now (it also refreshes once a day). */
export async function syncSheetNowAction(brandId: number) {
  const { workspace } = await requireEditor();
  if (!(await getBrand(workspace.id, brandId))) return;
  await enqueue("sheets.sync", { workspaceId: workspace.id, brandId }, workspace.id);
  kickJobs();
  revalidatePath(`/brands/${brandId}`);
}
