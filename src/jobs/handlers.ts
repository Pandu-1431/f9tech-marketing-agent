import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { writePostCopy, writePostsCopyBatch } from "@/agent/copywriter";
import { chunk, mapLimit, parallelism } from "@/lib/concurrency";
import { planCampaign } from "@/agent/planner";
import { QuotaExceededError } from "@/agent/router";
import { designPost } from "@/agent/designer";
import { makeReel } from "@/agent/video/reel";
import type { PosterTemplate } from "@/agent/images/poster";
import { TrialEndedError } from "@/lib/plan";
import { getBrand, getCampaign, setCampaignStatus, setDemoPart, updatePost } from "@/lib/data";

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
    if (err instanceof QuotaExceededError || err instanceof TrialEndedError) throw permanent(err.message);
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

  // Write several posts per AI call, and run a few calls at the same time.
  const { text: parallel, postsPerCall } = parallelism();
  let failures = 0;
  let limitError: Error | null = null;
  const batches = chunk(ideas, postsPerCall);
  await mapLimit(batches, parallel, async (batch) => {
    if (limitError) return;
    let written = new Map<number, Awaited<ReturnType<typeof writePostCopy>>>();
    try {
      written = await writePostsCopyBatch(campaign, brand, batch);
    } catch (err) {
      if (err instanceof QuotaExceededError || err instanceof TrialEndedError) {
        limitError = err;
        return;
      }
      // Batch answer was unusable: fall back to one post at a time below.
    }
    for (const post of batch) {
      try {
        const { demo, ...copy } = written.get(post.id) ?? (await writePostCopy(campaign, brand, post));
        await updatePost(workspaceId, post.id, { ...copy, status: "drafted" });
        await setDemoPart(workspaceId, post.id, "text", demo);
      } catch (err) {
        if (err instanceof QuotaExceededError || err instanceof TrialEndedError) {
          limitError = err;
          return;
        }
        failures++;
      }
    }
  });
  if (limitError) {
    await setCampaignStatus(workspaceId, campaignId, "failed", { error: (limitError as Error).message });
    return; // stop quietly: the user has hit the free limit
  }

  if (failures > 0) {
    // Leave failed ideas as "idea" and let the queue retry this job.
    throw new Error(`${failures} post(s) could not be written yet`);
  }
  await setCampaignStatus(workspaceId, campaignId, "ready", { error: null });
  const { enqueue } = await import("./queue");
  await enqueue("campaign.design", { workspaceId, campaignId }, workspaceId);
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
    const { demo, ...copy } = await writePostCopy(campaign, brand, post);
    await updatePost(workspaceId, post.id, { ...copy, status: "drafted", reviewNote: null, designStatus: "designing" });
    await setDemoPart(workspaceId, post.id, "text", demo);
    const fresh = { ...post, ...copy, status: "drafted" };
    await designPost(fresh, brand);
  } catch (err) {
    if (err instanceof QuotaExceededError || err instanceof TrialEndedError) throw permanent(err.message);
    throw err;
  }
};

/** Step 3: make a poster for every drafted post that has none yet. */
const designCampaignJob: Handler = async (payload) => {
  const { workspaceId, campaignId } = ids(payload);
  const campaign = await getCampaign(workspaceId, campaignId);
  if (!campaign) throw permanent("Campaign not found");
  const brand = await getBrand(workspaceId, campaign.brandId);
  if (!brand) throw permanent("Brand not found");
  const db = await getDb();
  const todo = await db
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.campaignId, campaignId)));
  let failures = 0;
  let stop = false;
  const toDesign = todo.filter((p) => p.designStatus !== "done" && p.status !== "idea");
  await mapLimit(toDesign, parallelism().image, async (post) => {
    if (stop) return;
    try {
      await updatePost(workspaceId, post.id, { designStatus: "designing" });
      await designPost(post, brand);
    } catch (err) {
      await updatePost(workspaceId, post.id, { designStatus: "failed" });
      if (err instanceof QuotaExceededError || err instanceof TrialEndedError) stop = true;
      else failures++;
    }
  });
  if (stop) return;
  if (failures > 0) throw new Error(`${failures} poster(s) could not be made yet`);

  // Posts planned as reels get a video automatically.
  const { enqueue } = await import("./queue");
  for (const post of todo.filter((p) => p.format === "reel" && p.reelStatus === "none" && p.status !== "idea")) {
    await updatePost(workspaceId, post.id, { reelStatus: "making" });
    await enqueue("post.reel", { workspaceId, postId: post.id }, workspaceId);
  }
};

/** Video Studio: make (or remake) the reel video for one post. */
const reelPostJob: Handler = async (payload) => {
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
    await updatePost(workspaceId, postId, { reelStatus: "making", reelError: null });
    await makeReel(campaign, brand, post);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updatePost(workspaceId, postId, { reelStatus: "failed", reelError: message.slice(0, 500) });
    if (err instanceof QuotaExceededError || err instanceof TrialEndedError) throw permanent(message);
    throw err;
  }
};
reelPostJob.onFinalFailure = async (payload, error) => {
  await updatePost(Number(payload.workspaceId), Number(payload.postId), { reelStatus: "failed", reelError: error.slice(0, 500) });
};

/** Redesign one post: new background and/or another template. */
const designPostJob: Handler = async (payload) => {
  const workspaceId = Number(payload.workspaceId);
  const postId = Number(payload.postId);
  const db = await getDb();
  const [post] = await db
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.id, postId)));
  if (!post) throw permanent("Post not found");
  const brand = await getBrand(workspaceId, post.brandId);
  if (!brand) throw permanent("Brand not found");
  try {
    await designPost(post, brand, {
      newBackground: Boolean(payload.newBackground),
      template: (payload.template as PosterTemplate | undefined) ?? undefined,
    });
  } catch (err) {
    await updatePost(workspaceId, postId, { designStatus: "failed" });
    if (err instanceof QuotaExceededError || err instanceof TrialEndedError) throw permanent(err.message);
    throw err;
  }
};

export const handlers = {
  "campaign.plan": planCampaignJob,
  "campaign.write": writeCampaignJob,
  "post.rewrite": rewritePostJob,
  "campaign.design": designCampaignJob,
  "post.design": designPostJob,
  "post.reel": reelPostJob,
} satisfies Record<string, Handler>;
