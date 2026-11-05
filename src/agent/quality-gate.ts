import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { capHashtags } from "@/lib/formats";
import { getBrand, getCampaign, recordPostVersion, setDemoPart, updatePost } from "@/lib/data";
import { TrialEndedError } from "@/lib/plan";
import { writePostCopy } from "./copywriter";
import { designPost } from "./designer";
import { checkPost, fixNotes, qcStatusOf, type QcIssue } from "./quality";
import { QuotaExceededError } from "./router";

/** How many times the agent may rewrite a post on its own to fix it (protects the free AI quota). */
export function maxAutoFixes(): number {
  const n = Number(process.env.AGENT_QC_AUTOFIX ?? "1");
  return Number.isFinite(n) && n >= 0 ? Math.min(3, Math.floor(n)) : 1;
}

async function load(workspaceId: number, postId: number) {
  const db = await getDb();
  const [post] = await db.select().from(schema.posts).where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.id, postId)));
  if (!post) return null;
  const [campaign, brand] = await Promise.all([getCampaign(workspaceId, post.campaignId), getBrand(workspaceId, post.brandId)]);
  if (!campaign || !brand) return null;
  const siblings = await db
    .select({ id: schema.posts.id, posterHeadline: schema.posts.posterHeadline })
    .from(schema.posts)
    .where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.campaignId, post.campaignId)));
  return { post, campaign, brand, siblings, issues: checkPost({ post, brand, campaign, siblings }) };
}

/**
 * Check a post, fix what the agent can fix by itself, and save the result on the post.
 * - Too many hashtags: trimmed to the platform limit (no AI call).
 * - Wrong numbers, risky promises, a long headline...: the copywriter rewrites the post once
 *   with the problems listed, the poster is remade, and the post is checked again.
 * autoFix=false only checks (used after a person edits or redesigns a post).
 */
export async function qualityGate(workspaceId: number, postId: number, opts: { autoFix?: boolean } = {}): Promise<QcIssue[]> {
  const autoFix = opts.autoFix ?? true;
  let state = await load(workspaceId, postId);
  if (!state) return [];

  // Hashtags: a plain trim, always safe.
  if (state.issues.some((i) => i.fix === "hashtags")) {
    const p = state.post;
    await updatePost(workspaceId, postId, { hashtags: capHashtags(p.platform, p.hashtags, p.format) });
    await recordPostVersion(workspaceId, postId, "qc_fix");
    state = (await load(workspaceId, postId))!;
  }

  const rewrite = state.issues.filter((i) => i.level === "fail" && i.fix === "rewrite");
  if (autoFix && rewrite.length && state.post.qcFixes < maxAutoFixes() && state.post.demoParts.length === 0) {
    const { post, campaign, brand } = state;
    await updatePost(workspaceId, postId, { qcFixes: post.qcFixes + 1 });
    try {
      const { demo, ...copy } = await writePostCopy(campaign, brand, post, { notes: fixNotes(state.issues) });
      await updatePost(workspaceId, postId, { ...copy, status: "drafted", designStatus: post.format === "text" ? post.designStatus : "designing" });
      await setDemoPart(workspaceId, postId, "text", demo);
      await recordPostVersion(workspaceId, postId, "qc_fix");
      const fresh = { ...post, ...copy, posterTemplate: copy.posterTemplate ?? post.posterTemplate, status: "drafted" };
      if (post.designStatus === "done" || post.designStatus === "failed") await designPost(fresh, brand);
    } catch (err) {
      // Out of free AI for now: keep the post as it was and report what is wrong.
      if (!(err instanceof QuotaExceededError || err instanceof TrialEndedError)) throw err;
      await updatePost(workspaceId, postId, { designStatus: state.post.designStatus });
    }
    state = (await load(workspaceId, postId))!;
  }

  await updatePost(workspaceId, postId, { qcStatus: qcStatusOf(state.issues), qcIssues: state.issues, qcCheckedAt: new Date() });
  return state.issues;
}

