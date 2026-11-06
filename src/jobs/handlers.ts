import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { writePostCopy, writePostsCopyBatch } from "@/agent/copywriter";
import { chunk, mapLimit, parallelism, pipelinePosters } from "@/lib/concurrency";
import { memoryLines } from "@/agent/memory";
import { exemplarLines } from "@/agent/training/exemplars";
import { planCampaign } from "@/agent/planner";
import { QuotaExceededError } from "@/agent/router";
import { designPost } from "@/agent/designer";
import { qualityGate } from "@/agent/quality-gate";
import { fixNotes } from "@/agent/quality";
import { makeReel } from "@/agent/video/reel";
import { isReelStyle } from "@/agent/video/styles";
import type { PosterTemplate } from "@/agent/images/poster";
import { TrialEndedError } from "@/lib/plan";
import { friendlyError, getBrand, getCampaign, recordPostVersion, setCampaignStatus, setDemoPart, updatePost } from "@/lib/data";

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
  // The brand's memory (reviewer rules, what worked) is loaded once here, not once per post.
  const { text: parallel, postsPerCall } = parallelism();
  const memory = await memoryLines(workspaceId, brand.id);
  // The brand's own best posts (measured, edited-then-approved, approved) as style examples.
  const examples = await exemplarLines(workspaceId, brand.id, campaign.platforms);
  const { enqueue } = await import("./queue");
  let failures = 0;
  let limitError: Error | null = null;
  const batches = chunk(ideas, postsPerCall);
  await mapLimit(batches, parallel, async (batch) => {
    if (limitError) return;
    let written = new Map<number, Awaited<ReturnType<typeof writePostCopy>>>();
    try {
      written = await writePostsCopyBatch(campaign, brand, batch, { memory, examples });
    } catch (err) {
      if (err instanceof QuotaExceededError || err instanceof TrialEndedError) {
        limitError = err;
        return;
      }
      // Batch answer was unusable: fall back to one post at a time below.
    }
    for (const post of batch) {
      try {
        const { demo, ...copy } = written.get(post.id) ?? (await writePostCopy(campaign, brand, post, { memory, examples }));
        await updatePost(workspaceId, post.id, { ...copy, status: "drafted", designStatus: pipelinePosters() ? "designing" : post.designStatus });
        await setDemoPart(workspaceId, post.id, "text", demo);
        await recordPostVersion(workspaceId, post.id, "ai_write");
        // Pipelined: this post's poster starts now, in another lane, while the next batch is still being written.
        if (pipelinePosters()) await enqueue("post.design", { workspaceId, postId: post.id, thenReel: true }, workspaceId);
      } catch (err) {
        if (err instanceof QuotaExceededError || err instanceof TrialEndedError) {
          limitError = err;
          return;
        }
        failures++;
        await updatePost(workspaceId, post.id, { lastError: friendlyError(err instanceof Error ? err.message : String(err)) });
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
  // Posters not started by the pipeline above (older posts, text-only formats, retries) and the reels.
  await enqueue("campaign.design", { workspaceId, campaignId }, workspaceId);
};
writeCampaignJob.onFinalFailure = async (payload, error) => {
  const { workspaceId, campaignId } = ids(payload);
  await setCampaignStatus(workspaceId, campaignId, "failed", { error: friendlyError(error) });
  // The posts that WERE written still get their posters; the rest show "Try again".
  const { enqueue } = await import("./queue");
  await enqueue("campaign.design", { workspaceId, campaignId }, workspaceId);
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
    // The reviewer's note and the quality checker's findings tell the copywriter what to change.
    const notes = [post.reviewNote ?? "", ...fixNotes(post.qcIssues ?? [])];
    const examples = await exemplarLines(workspaceId, brand.id, [post.platform]);
    const { demo, ...copy } = await writePostCopy(campaign, brand, post, { notes, examples });
    await updatePost(workspaceId, post.id, { ...copy, status: "drafted", reviewNote: null, designStatus: "designing", lastError: null });
    await setDemoPart(workspaceId, post.id, "text", demo);
    await recordPostVersion(workspaceId, post.id, "ai_rewrite");
    const fresh = { ...post, ...copy, posterTemplate: copy.posterTemplate ?? post.posterTemplate, status: "drafted" };
    await designPost(fresh, brand);
    await qualityGate(workspaceId, post.id, { autoFix: false });
  } catch (err) {
    if (err instanceof QuotaExceededError || err instanceof TrialEndedError) throw permanent(err.message);
    throw err;
  }
};

/** Step 3: make a poster for every drafted post that has none yet. */
/** Rewrite gave up: put the post back as it was (never stuck on "Writing…") and say why. */
rewritePostJob.onFinalFailure = async (payload, error) => {
  const workspaceId = Number(payload.workspaceId);
  const postId = Number(payload.postId);
  const db = await getDb();
  const [post] = await db.select().from(schema.posts).where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.id, postId)));
  if (!post) return;
  await updatePost(workspaceId, postId, {
    status: post.caption ? "drafted" : "idea",
    designStatus: post.designStatus === "designing" ? (post.currentVersion > 0 ? "done" : "failed") : post.designStatus,
    lastError: friendlyError(error),
  });
};

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
  // "designing" posts already have their own post.design job (pipelined from the write step).
  const toDesign = todo.filter((p) => p.designStatus !== "done" && p.designStatus !== "designing" && p.status !== "idea");
  await mapLimit(toDesign, parallelism().image, async (post) => {
    if (stop) return;
    try {
      await updatePost(workspaceId, post.id, { designStatus: "designing" });
      await designPost(post, brand);
      // Quality checker: checks the post and fixes what it can before a person sees it.
      await qualityGate(workspaceId, post.id);
    } catch (err) {
      await updatePost(workspaceId, post.id, { designStatus: "failed" });
      if (err instanceof QuotaExceededError || err instanceof TrialEndedError) stop = true;
      else failures++;
    }
  });
  if (stop) return;

  // Posts planned as reels get a video automatically — even when another post's poster failed
  // (one failed poster used to block every video in the campaign).
  const { enqueue } = await import("./queue");
  const fresh = await db
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.campaignId, campaignId)));
  for (const post of fresh.filter((p) => p.format === "reel" && p.reelStatus === "none" && p.status !== "idea" && p.designStatus !== "designing")) {
    await updatePost(workspaceId, post.id, { reelStatus: "making" });
    await enqueue("post.reel", { workspaceId, postId: post.id }, workspaceId);
  }
  if (failures > 0) throw new Error(`${failures} poster(s) could not be made yet`);
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
    // payload.styles: one or more video styles ("Make all styles"). One video per job, so a retry
    // never remakes the videos that already worked; the rest are queued as the next job.
    const styles = (Array.isArray(payload.styles) ? payload.styles : [payload.style]).filter(isReelStyle);
    const [style, ...rest] = styles;
    await updatePost(workspaceId, postId, { reelStatus: "making", reelError: null });
    await makeReel(campaign, brand, post, style);
    if (rest.length) {
      await updatePost(workspaceId, postId, { reelStatus: "making" });
      const { enqueue } = await import("./queue");
      await enqueue("post.reel", { workspaceId, postId, styles: rest }, workspaceId);
      return;
    }
    await qualityGate(workspaceId, postId, { autoFix: false });
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
/** Campaign posters gave up: no post stays on "Designing…". */
designCampaignJob.onFinalFailure = async (payload, error) => {
  const { workspaceId, campaignId } = ids(payload);
  const db = await getDb();
  await db
    .update(schema.posts)
    .set({ designStatus: "failed", lastError: friendlyError(error) })
    .where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.campaignId, campaignId), eq(schema.posts.designStatus, "designing")));
};

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
    // Pipelined from the write step: the first check may rewrite and redesign, like the campaign job does.
    await qualityGate(workspaceId, postId, { autoFix: Boolean(payload.thenReel) });
    if (payload.thenReel && post.format === "reel" && post.reelStatus === "none") {
      await updatePost(workspaceId, postId, { reelStatus: "making" });
      const { enqueue } = await import("./queue");
      await enqueue("post.reel", { workspaceId, postId }, workspaceId);
    }
  } catch (err) {
    await updatePost(workspaceId, postId, { designStatus: "failed" });
    if (err instanceof QuotaExceededError || err instanceof TrialEndedError) throw permanent(err.message);
    throw err;
  }
};

/** Weekly autopilot: pick the week's theme and start the campaign pipeline. */
const autopilotJob: Handler = async (payload) => {
  const { runAutopilot } = await import("@/agent/autopilot");
  try {
    await runAutopilot(Number(payload.workspaceId), Number(payload.brandId), { now: payload.at ? new Date(String(payload.at)) : undefined });
  } catch (err) {
    if (err instanceof QuotaExceededError || err instanceof TrialEndedError) throw permanent(err.message);
    throw err;
  }
};

/** Marketing Director: write the brand's four-week plan (on demand; the autopilot also refreshes it). */
const directorPlanJob: Handler = async (payload) => {
  const { makeMarketingPlan } = await import("@/agent/director");
  try {
    await makeMarketingPlan(Number(payload.workspaceId), Number(payload.brandId), { startNow: Boolean(payload.startNow) });
  } catch (err) {
    if (err instanceof QuotaExceededError || err instanceof TrialEndedError) throw permanent(err.message);
    throw err;
  }
};

/** Blog & SEO writer: write one article (and its cover image). */
const articleJob: Handler = async (payload) => {
  const { writeArticle } = await import("@/agent/articles");
  try {
    await writeArticle(Number(payload.workspaceId), Number(payload.articleId));
  } catch (err) {
    if (err instanceof QuotaExceededError || err instanceof TrialEndedError) throw permanent(err.message);
    throw err;
  }
};

/** Analyst: read post results, learn, remember (daily per brand). */
const analystJob: Handler = async (payload) => {
  const { runAnalyst } = await import("@/agent/analyst");
  await runAnalyst(Number(payload.workspaceId), Number(payload.brandId), { now: payload.at ? new Date(String(payload.at)) : undefined });
  // Fresh numbers: refresh the brand's Google Sheet too (when one is connected).
  const { hasSheet } = await import("@/agent/sheets");
  if (await hasSheet(Number(payload.workspaceId), Number(payload.brandId))) {
    const { enqueue } = await import("./queue");
    await enqueue("sheets.sync", { workspaceId: Number(payload.workspaceId), brandId: Number(payload.brandId) }, Number(payload.workspaceId));
  }
};

/** Learn a writing rule from a person's edit of an AI caption (queued when the post is approved). */
const learnEditJob: Handler = async (payload) => {
  const workspaceId = Number(payload.workspaceId);
  const brand = await getBrand(workspaceId, Number(payload.brandId));
  if (!brand) return;
  const { learnFromEdit } = await import("@/agent/training/edit-lesson");
  try {
    await learnFromEdit(workspaceId, brand, Number(payload.postId));
  } catch (err) {
    // A lesson is a bonus: never retry into the free quota for it.
    if (err instanceof QuotaExceededError || err instanceof TrialEndedError) return;
    throw err;
  }
};

/** SEO kit: real searches -> keywords, questions and hashtag sets for the brand. */
const seoKitJob: Handler = async (payload) => {
  const workspaceId = Number(payload.workspaceId);
  const brand = await getBrand(workspaceId, Number(payload.brandId));
  if (!brand) throw permanent("Brand not found");
  const { buildSeoKit } = await import("@/agent/seo");
  try {
    await buildSeoKit(workspaceId, brand);
  } catch (err) {
    if (err instanceof QuotaExceededError || err instanceof TrialEndedError) throw permanent(err.message);
    throw err;
  }
};

/** Google Sheet: rewrite the brand's post tracker sheet. */
const sheetsSyncJob: Handler = async (payload) => {
  const { syncBrandSheet } = await import("@/agent/sheets");
  await syncBrandSheet(Number(payload.workspaceId), Number(payload.brandId));
};

/** Publisher: send one approved post version to its channel. */
const publishJob: Handler = async (payload) => {
  const { sendPublication } = await import("@/agent/publish");
  await sendPublication(Number(payload.workspaceId), Number(payload.publicationId));
};

designPostJob.onFinalFailure = async (payload, error) => {
  await updatePost(Number(payload.workspaceId), Number(payload.postId), { designStatus: "failed", lastError: friendlyError(error) });
};

export const handlers = {
  "autopilot.run": autopilotJob,
  "director.plan": directorPlanJob,
  "article.write": articleJob,
  "analyst.run": analystJob,
  "post.publish": publishJob,
  "campaign.plan": planCampaignJob,
  "campaign.write": writeCampaignJob,
  "post.rewrite": rewritePostJob,
  "campaign.design": designCampaignJob,
  "post.design": designPostJob,
  "post.reel": reelPostJob,
  "post.learn_edit": learnEditJob,
  "brand.seo": seoKitJob,
  "sheets.sync": sheetsSyncJob,
} satisfies Record<string, Handler>;
