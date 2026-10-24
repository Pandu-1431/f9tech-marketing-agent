import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { writePostCopy } from "@/agent/copywriter";
import { planCampaign } from "@/agent/planner";
import { QuotaExceededError } from "@/agent/router";
import { getBrand, getCampaign, setCampaignStatus, updatePost } from "@/lib/data";

type Payload = Record<string, unknown>;
type Handler = ((payload: Payload) => Promise<void>) & {
  onFinalFailure?: (payload: Payload, error: string) => Promise<void>;
};

const permanent = (message: string) => Object.assign(new Error(message), { permanent: true });

const ids = (p: Payload) => ({ workspaceId: Number(p.workspaceId), campaignId: Number(p.campaignId) });

/** Step 1: theme -> calendar of post ideas. Then queues step 2. */
const planCampaignJob: Handler = async (payload) => {
  const { workspaceId, campaignId } = ids(payload);
  const campaign = await getCampaign(workspaceId, campaignId);
  if (!campaign) throw permanent("Campaign not found");
  const brand = await getBrand(workspaceId, campaign.brandId);
  if (!brand) throw permanent("Brand not found");

  await setCampaignStatus(workspaceId, campaignId, "planning", { error: null });
  try {
    const { strategy } = await planCampaign(campaign, brand);
    await setCampaignStatus(workspaceId, campaignId, "writing", { strategy });
  } catch (err) {
    if (err instanceof QuotaExceededError) throw permanent(err.message);
    throw err;
  }

  const { enqueue } = await import("./queue");
  await enqueue("campaign.write", { workspaceId, campaignId }, workspaceId);
};
planCampaignJob.onFinalFailure = async (payload, error) => {
  const { workspaceId, campaignId } = ids(payload);
  await setCampaignStatus(workspaceId, campaignId, "failed", { error });
};

/** Step 2: write caption, hashtags, image prompt, SEO keywords for every idea. */
const writeCampaignJob: Handler = async (payload) => {
  const { workspaceId, campaignId } = ids(payload);
  const campaign = await getCampaign(workspaceId, campaignId);
  if (!campaign) throw permanent("Campaign not found");
  const brand = await getBrand(workspaceId, campaign.brandId);
  if (!brand) throw permanent("Brand not found");

  const db = await getDb();
  const ideas = await db
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.campaignId, campaignId), eq(schema.posts.status, "idea")));

  let failures = 0;
  for (const post of ideas) {
    try {
      const copy = await writePostCopy(campaign, brand, post);
      await updatePost(workspaceId, post.id, { ...copy, status: "drafted" });
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        await setCampaignStatus(workspaceId, campaignId, "failed", { error: err.message });
        return; // stop quietly: the user has hit the free limit
      }
      failures++;
    }
  }

  if (failures > 0) {
    // Leave failed ideas as "idea" and let the queue retry this job.
    throw new Error(`${failures} post(s) could not be written yet`);
  }
  await setCampaignStatus(workspaceId, campaignId, "ready", { error: null });
};
writeCampaignJob.onFinalFailure = async (payload, error) => {
  const { workspaceId, campaignId } = ids(payload);
  await setCampaignStatus(workspaceId, campaignId, "failed", { error });
};

/** Re-write a single post (the "regenerate" button). */
const rewritePostJob: Handler = async (payload) => {
  const workspaceId = Number(payload.workspaceId);
  const postId = Number(payload.postId);
  const db = await getDb();
  const [post] = await db
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.id, postId)));
  if (!post) throw permanent("Post not found");
  const campaign = await getCampaign(workspaceId, post.campaignId);
  const brand = await getBrand(workspaceId, post.brandId);
  if (!campaign || !brand) throw permanent("Campaign or brand not found");
  try {
    const copy = await writePostCopy(campaign, brand, post);
    await updatePost(workspaceId, post.id, { ...copy, status: "drafted", reviewNote: null });
  } catch (err) {
    if (err instanceof QuotaExceededError) throw permanent(err.message);
    throw err;
  }
};

export const handlers = {
  "campaign.plan": planCampaignJob,
  "campaign.write": writeCampaignJob,
  "post.rewrite": rewritePostJob,
} satisfies Record<string, Handler>;
