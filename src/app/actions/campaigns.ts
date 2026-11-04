"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAuth, requireEditor } from "@/lib/auth";
import {
  createCampaign,
  DemoContentError,
  getCampaign,
  getPost,
  BusyPostError,
  LimitError,
  listCampaignPosts,
  recordPostVersion,
  reviewPost,
  StaleVersionError,
  setCampaignStatus,
  setDemoPart,
  updatePost,
} from "@/lib/data";
import { enqueue, processJobs } from "@/jobs/queue";
import type { FormState } from "./auth";
import { POSTER_TEMPLATES } from "@/agent/images/poster";
import { FORMATS } from "@/agent/planner";
import { CAMPAIGN_TYPE_KEYS, type CampaignType } from "@/lib/campaign-types";

/** In dev / single-server mode, run queued jobs right after the response. */
function kickJobs() {
  if (process.env.AGENT_INLINE_JOBS !== "false") {
    after(async () => {
      await processJobs(30);
    });
  }
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const optionalText = (max: number) => z.string().trim().max(max).optional();

const campaignSchema = z
  .object({
    brandId: z.coerce.number().int().positive("Pick a business account"),
    campaignType: z.enum(CAMPAIGN_TYPE_KEYS as [CampaignType, ...CampaignType[]], { message: "Pick a campaign type" }),
    theme: z.string().trim().min(3, "Describe the theme").max(300),
    goal: optionalText(1000),
    audience: optionalText(500),
    keyFacts: optionalText(2000),
    eventDate: z.string().regex(isoDate, "Pick a valid event date").optional(),
    location: optionalText(200),
    callToAction: optionalText(60),
    ctaUrl: z.url({ protocol: /^https?$/, message: "Link must start with http:// or https://" }).max(300).optional(),
    language: optionalText(60),
    hashtags: z.array(z.string()).max(10, "Use 10 campaign hashtags or fewer"),
    formats: z.array(z.enum(FORMATS)).min(1, "Pick at least one post format"),
    platforms: z.array(z.string()).min(1, "Pick at least one platform"),
    startDate: z.string().regex(isoDate, "Pick a start date"),
    endDate: z.string().regex(isoDate, "Pick an end date"),
    postsPerWeek: z.coerce.number().int().min(1).max(14),
  })
  .refine((v) => v.endDate >= v.startDate, { message: "End date must be after start date" })
  .refine((v) => (Date.parse(v.endDate) - Date.parse(v.startDate)) / 86400000 <= 62, {
    message: "Keep a campaign to 2 months or less",
  })
  .refine((v) => v.campaignType !== "event" || v.eventDate, { message: "An event campaign needs the event date" })
  .refine((v) => !v.eventDate || v.eventDate >= v.startDate, { message: "Event date must be on or after the campaign start" });

/** "#a, b  #c" -> ["#a", "#b", "#c"] */
function parseHashtags(raw: FormDataEntryValue | null): string[] {
  const tags = String(raw ?? "")
    .split(/[\s,]+/)
    .map((h) => h.trim())
    .filter(Boolean)
    .map((h) => (h.startsWith("#") ? h : `#${h}`));
  return Array.from(new Set(tags));
}

export async function createCampaignAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { workspace } = await requireEditor();
  const text = (name: string) => String(formData.get(name) ?? "").trim() || undefined;
  const parsed = campaignSchema.safeParse({
    brandId: formData.get("brandId"),
    campaignType: formData.get("campaignType") || "general",
    theme: formData.get("theme"),
    goal: text("goal"),
    audience: text("audience"),
    keyFacts: text("keyFacts"),
    eventDate: text("eventDate"),
    location: text("location"),
    callToAction: text("callToAction"),
    ctaUrl: text("ctaUrl"),
    language: text("language"),
    hashtags: parseHashtags(formData.get("hashtags")),
    formats: formData.getAll("formats").map(String),
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
  const { workspace, user } = await requireAuth(); // client reviewers may approve too
  const post = await getPost(workspace.id, postId);
  if (!post) return;
  const note = String(formData.get("note") ?? "").trim() || null;
  // The version the reviewer saw on screen. If the post changed since, the approval is refused.
  const version = Number(formData.get("version"));
  try {
    await reviewPost(workspace.id, postId, decision, note, { userId: user.id, version });
  } catch (err) {
    // Demo / busy / stale: the UI shows the reason on the card; these are the server-side guards.
    if (!(err instanceof DemoContentError || err instanceof StaleVersionError || err instanceof BusyPostError)) throw err;
  }
  revalidatePath(`/campaigns/${post.campaignId}`);
}

export async function editPostAction(postId: number, formData: FormData) {
  const { workspace, user } = await requireEditor();
  const post = await getPost(workspace.id, postId);
  if (!post) return;
  const hashtags = parseHashtags(formData.get("hashtags"));
  await updatePost(workspace.id, postId, {
    caption: String(formData.get("caption") ?? "").trim(),
    hashtags,
    imagePrompt: String(formData.get("imagePrompt") ?? "").trim(),
    status: "drafted",
  });
  // A person wrote or checked this caption, so it is no longer demo text.
  await setDemoPart(workspace.id, postId, "text", false);
  await recordPostVersion(workspace.id, postId, "caption", user.id);
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

export async function redesignPostAction(postId: number, opts: { newBackground?: boolean; template?: string }) {
  const { workspace } = await requireEditor();
  const post = await getPost(workspace.id, postId);
  if (!post) return;
  const template = opts.template && (POSTER_TEMPLATES as readonly string[]).includes(opts.template) ? opts.template : undefined;
  await updatePost(workspace.id, postId, { designStatus: "designing" });
  await enqueue("post.design", { workspaceId: workspace.id, postId, newBackground: Boolean(opts.newBackground), template }, workspace.id);
  kickJobs();
  revalidatePath(`/campaigns/${post.campaignId}`);
}

export async function editPosterTextAction(postId: number, formData: FormData) {
  const { workspace } = await requireEditor();
  const post = await getPost(workspace.id, postId);
  if (!post) return;
  await updatePost(workspace.id, postId, {
    posterHeadline: String(formData.get("posterHeadline") ?? "").trim().slice(0, 120) || null,
    posterCta: String(formData.get("posterCta") ?? "").trim().slice(0, 60) || null,
    designStatus: "designing",
  });
  await enqueue("post.design", { workspaceId: workspace.id, postId }, workspace.id);
  kickJobs();
  revalidatePath(`/campaigns/${post.campaignId}`);
}

export async function makeReelAction(postId: number) {
  const { workspace } = await requireEditor();
  const post = await getPost(workspace.id, postId);
  if (!post) return;
  await updatePost(workspace.id, postId, { reelStatus: "making", reelError: null });
  await enqueue("post.reel", { workspaceId: workspace.id, postId }, workspace.id);
  kickJobs();
  revalidatePath(`/campaigns/${post.campaignId}`);
}
