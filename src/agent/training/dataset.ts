import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Brand, Campaign, Post } from "@/db/schema";
import { brandSystemPrompt } from "../brand-context";
import { copyPrompt } from "../copywriter";
import { changeRatio, MIN_CHANGE } from "./edit-lesson";

/*
 * Training dataset: everything the team approved, edited and rejected, turned into files a
 * fine-tuning service accepts (OpenAI chat JSONL; also read by Together, Fireworks, Unsloth, Axolotl).
 *
 *   SFT  : prompt the copywriter got -> the version a person approved.
 *   DPO  : same prompt, preferred answer vs. worse answer:
 *            - the person's edit (preferred) vs. the AI draft they changed,
 *            - the version approved later (preferred) vs. a version a reviewer rejected.
 *
 * Fine-tuning is optional and only worth it with enough examples (see READINESS). Until then the
 * same data already trains the agent through examples in prompts and rules in brand memory.
 * One brand per file; one workspace only.
 */

export const READINESS = { tryAt: 50, goodAt: 200 } as const;

type Version = typeof schema.postVersions.$inferSelect;
type Message = { role: "system" | "user" | "assistant"; content: string };
export type SftRow = { messages: Message[] };
export type DpoRow = { input: { messages: Message[] }; preferred_output: Message[]; non_preferred_output: Message[] };
export type DatasetStats = { approved: number; edited: number; rejectedThenApproved: number; sft: number; dpo: number };
export type Dataset = { sft: SftRow[]; dpo: DpoRow[]; stats: DatasetStats };

/** What the copywriter would have answered for this version (same JSON shape as its prompt asks for). */
export function answerJson(v: Pick<Version, "caption" | "hashtags" | "imagePrompt" | "posterHeadline" | "posterSubline" | "posterKicker" | "posterCta">): string {
  return JSON.stringify({
    caption: v.caption ?? "",
    hashtags: v.hashtags ?? [],
    image_prompt: v.imagePrompt ?? "",
    poster_headline: v.posterHeadline ?? "",
    poster_subline: v.posterSubline ?? "",
    poster_kicker: v.posterKicker ?? "",
    poster_cta: v.posterCta ?? "",
  });
}

const usable = (v: Version | undefined): v is Version => !!v && !!v.caption?.trim() && !v.demoParts.includes("text");

export async function buildDataset(workspaceId: number, brand: Brand): Promise<Dataset> {
  const db = await getDb();
  const posts = await db
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.brandId, brand.id)))
    .orderBy(asc(schema.posts.id));
  const stats: DatasetStats = { approved: 0, edited: 0, rejectedThenApproved: 0, sft: 0, dpo: 0 };
  if (!posts.length) return { sft: [], dpo: [], stats };

  const ids = posts.map((p) => p.id);
  const campaignIds = [...new Set(posts.map((p) => p.campaignId))];
  const [campaigns, versions, approvals] = await Promise.all([
    db.select().from(schema.campaigns).where(and(eq(schema.campaigns.workspaceId, workspaceId), inArray(schema.campaigns.id, campaignIds))),
    db.select().from(schema.postVersions).where(and(eq(schema.postVersions.workspaceId, workspaceId), inArray(schema.postVersions.postId, ids))),
    db.select().from(schema.approvals).where(and(eq(schema.approvals.workspaceId, workspaceId), inArray(schema.approvals.postId, ids))),
  ]);
  const campaignById = new Map(campaigns.map((c) => [c.id, c]));
  const versionsByPost = new Map<number, Version[]>();
  for (const v of versions) versionsByPost.set(v.postId, [...(versionsByPost.get(v.postId) ?? []), v]);
  for (const list of versionsByPost.values()) list.sort((a, b) => a.version - b.version);

  const system = brandSystemPrompt(brand);
  const sft: SftRow[] = [];
  const dpo: DpoRow[] = [];
  const prompt = (campaign: Campaign, post: Post): Message[] => [
    { role: "system", content: system },
    { role: "user", content: copyPrompt(campaign, post) },
  ];
  const pair = (input: Message[], good: Version, bad: Version) =>
    dpo.push({
      input: { messages: input },
      preferred_output: [{ role: "assistant", content: answerJson(good) }],
      non_preferred_output: [{ role: "assistant", content: answerJson(bad) }],
    });

  for (const post of posts) {
    const campaign = campaignById.get(post.campaignId);
    const list = versionsByPost.get(post.id) ?? [];
    if (!campaign || post.approvedVersion === null || !["approved", "published"].includes(post.status)) continue;
    const approved = list.find((v) => v.version === post.approvedVersion);
    if (!usable(approved)) continue;
    stats.approved++;
    const input = prompt(campaign, post);
    sft.push({ messages: [...input, { role: "assistant", content: answerJson(approved) }] });

    // A person rewrote the AI's caption before approving: their version beats the draft.
    const lastHuman = [...list].reverse().find((v) => v.reason === "caption" && v.version <= approved.version);
    const draft = lastHuman && [...list].reverse().find((v) => v.createdBy === null && ["ai_write", "ai_rewrite"].includes(v.reason) && v.version < lastHuman.version);
    if (usable(draft) && changeRatio(draft.caption ?? "", approved.caption ?? "") >= MIN_CHANGE) {
      stats.edited++;
      pair(input, approved, draft);
    }

    // Versions a reviewer rejected lose to the one approved later.
    const rejected = approvals.filter((a) => a.postId === post.id && a.decision === "rejected" && a.version < approved.version);
    for (const r of rejected) {
      const bad = list.find((v) => v.version === r.version);
      if (!usable(bad) || bad.caption === approved.caption) continue;
      stats.rejectedThenApproved++;
      pair(input, approved, bad);
    }
  }
  stats.sft = sft.length;
  stats.dpo = dpo.length;
  return { sft, dpo, stats };
}

export const toJsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
