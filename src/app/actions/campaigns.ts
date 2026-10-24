"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAuth, requireEditor } from "@/lib/auth";
import {
  createCampaign,
  getCampaign,
  getPost,
  LimitError,
  listCampaignPosts,
  setCampaignStatus,
  updatePost,
} from "@/lib/data";
import { enqueue, processJobs } from "@/jobs/queue";
import type { FormState } from "./auth";

/** In dev / single-server mode, run queued jobs right after the response. */
function kickJobs() {
  if (process.env.AGENT_INLINE_JOBS !== "false") {
    after(async () => {
      await processJobs(10);
    });
  }
}

const campaignSchema = z
  .object({
    brandId: z.coerce.number().int().positive("Pick a business account"),
    theme: z.string().trim().min(3, "Describe the theme").max(300),
    goal: z.string().trim().max(1000).optional(),
    platforms: z.array(z.string()).min(1, "Pick at least one platform"),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an end date"),
    postsPerWeek: z.coerce.number().int().min(1).max(14),
  })
  .refine((v) => v.endDate >= v.startDate, { message: "End date must be after start date" })
  .refine((v) => (Date.parse(v.endDate) - Date.parse(v.startDate)) / 86400000 <= 62, {
    message: "Keep a campaign to 2 months or less",
  });

export async function createCampaignAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { workspace } = await requireEditor();
  const parsed = campaignSchema.safeParse({
    brandId: formData.get("brandId"),
    theme: formData.get("theme"),
    goal: formData.get("goal") || undefined,
    platforms: formData.getAll("platforms").map(String),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    postsPerWeek: formData.get("postsPerWeek") || 3,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };

  let campaignId: number;
  try {
    const campaign = await createCampaign(workspace.id, parsed.data);
    campaignId = campaign.id;
  } catch (err) {
    if (err instanceof LimitError) return { error: err.message };
    throw err;
  }

  await enqueue("campaign.plan", { workspaceId: workspace.id, campaignId }, workspace.id);
  kickJobs();
  redirect(`/campaigns/${campaignId}`);
}

export async function reviewPostAction(postId: number, decision: "approved" | "rejected", formData: FormData) {
  const { workspace } = await requireAuth(); // client reviewers may approve too
  const post = await getPost(workspace.id, postId);
  if (!post) return;
  const note = String(formData.get("note") ?? "").trim() || null;
  await updatePost(workspace.id, postId, { status: decision, reviewNote: note });
  revalidatePath(`/campaigns/${post.campaignId}`);
}

export async function editPostAction(postId: number, formData: FormData) {
  const { workspace } = await requireEditor();
  const post = await getPost(workspace.id, postId);
  if (!post) return;
  const hashtags = String(formData.get("hashtags") ?? "")
    .split(/[\s,]+/)
    .map((h) => h.trim())
    .filter(Boolean)
    .map((h) => (h.startsWith("#") ? h : `#${h}`));
  await updatePost(workspace.id, postId, {
    caption: String(formData.get("caption") ?? "").trim(),
    hashtags,
    imagePrompt: String(formData.get("imagePrompt") ?? "").trim(),
    status: "drafted",
  });
  revalidatePath(`/campaigns/${post.campaignId}`);
}

export async function rewritePostAction(postId: number) {
  const { workspace } = await requireEditor();
  const post = await getPost(workspace.id, postId);
  if (!post) return;
  await updatePost(workspace.id, postId, { status: "idea" });
  await enqueue("post.rewrite", { workspaceId: workspace.id, postId }, workspace.id);
  kickJobs();
  revalidatePath(`/campaigns/${post.campaignId}`);
}

export async function retryCampaignAction(campaignId: number) {
  const { workspace } = await requireEditor();
  const campaign = await getCampaign(workspace.id, campaignId);
  if (!campaign) return;
  const hasPosts = (await listCampaignPosts(workspace.id, campaignId)).length > 0;
  await setCampaignStatus(workspace.id, campaignId, hasPosts ? "writing" : "planning", { error: null });
  await enqueue(hasPosts ? "campaign.write" : "campaign.plan", { workspaceId: workspace.id, campaignId }, workspace.id);
  kickJobs();
  revalidatePath(`/campaigns/${campaignId}`);
}
