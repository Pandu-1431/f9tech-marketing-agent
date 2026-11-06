import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Brand } from "@/db/schema";
import { parseJsonObject } from "../json";
import { generateText } from "../router";
import { rememberFeedback } from "../memory";

/*
 * Learning from edits. When a person rewrites the AI's caption and then approves it, the
 * difference is the clearest lesson there is ("shorter", "no emojis", "say Vizag not
 * Visakhapatnam"). One small AI call turns the before/after into one general rule, saved in
 * brand memory as an editor rule, so the next posts are written that way from the start.
 */

export type EditPair = { postId: number; platform: string; before: string; after: string };

const AI_REASONS = ["ai_write", "ai_rewrite"];

/** Word-level change between two captions, 0 (same) to 1 (nothing in common). */
export function changeRatio(a: string, b: string): number {
  const words = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);
  const wa = words(a);
  const wb = words(b);
  if (!wa.length && !wb.length) return 0;
  const count = new Map<string, number>();
  for (const w of wa) count.set(w, (count.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of wb) {
    const n = count.get(w) ?? 0;
    if (n > 0) {
      common++;
      count.set(w, n - 1);
    }
  }
  return 1 - (2 * common) / (wa.length + wb.length);
}

/** Below this the edit is a typo fix, not a lesson. */
export const MIN_CHANGE = 0.12;

/**
 * The AI caption and the person's final caption for an approved post, or null when the
 * approved version was not a human edit of an AI draft (or the change is too small).
 */
export async function editPairForPost(workspaceId: number, postId: number): Promise<EditPair | null> {
  const db = await getDb();
  const [post] = await db.select().from(schema.posts).where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.id, postId)));
  if (!post || post.approvedVersion === null) return null;
  const [approved] = await db
    .select()
    .from(schema.postVersions)
    .where(and(eq(schema.postVersions.postId, postId), eq(schema.postVersions.version, post.approvedVersion)));
  if (!approved) return null;
  // The approved text may sit on a later poster/reel version; find the person's last caption version.
  const [human] = await db
    .select()
    .from(schema.postVersions)
    .where(and(eq(schema.postVersions.postId, postId), eq(schema.postVersions.reason, "caption"), lt(schema.postVersions.version, post.approvedVersion + 1)))
    .orderBy(desc(schema.postVersions.version))
    .limit(1);
  if (!human) return null;
  const [ai] = await db
    .select()
    .from(schema.postVersions)
    .where(
      and(
        eq(schema.postVersions.postId, postId),
        isNull(schema.postVersions.createdBy),
        inArray(schema.postVersions.reason, AI_REASONS),
        lt(schema.postVersions.version, human.version),
      ),
    )
    .orderBy(desc(schema.postVersions.version))
    .limit(1);
  if (!ai || ai.demoParts.includes("text")) return null;
  const before = (ai.caption ?? "").trim();
  const after = (approved.caption ?? "").trim();
  if (!before || !after || changeRatio(before, after) < MIN_CHANGE) return null;
  return { postId, platform: post.platform, before, after };
}

export function editLessonPrompt(pair: EditPair): string {
  return [
    "TASK: EDIT_LESSON",
    `PLATFORM: ${pair.platform}`,
    "The AI wrote BEFORE. A person on the brand's team rewrote it as AFTER and approved it.",
    "What general writing rule explains the change, so future posts are written that way from the start?",
    "- One rule, max 25 words, an instruction (e.g. \"Keep captions under 40 words and use at most one emoji.\").",
    "- It must be general (about style, tone, length, words, structure), not about this post's topic or facts.",
    "- If the change is only a fact fix or about this one post, set general to false.",
    "",
    `BEFORE: ${pair.before}`,
    "",
    `AFTER: ${pair.after}`,
    "",
    'Reply with JSON only: {"rule": "...", "general": true}',
  ].join("\n");
}

const lessonSchema = z.object({ rule: z.string().default(""), general: z.boolean().default(false) });

/** Turn one approved edit into a brand rule. Returns the saved rule text, or null. */
export async function learnFromEdit(workspaceId: number, brand: Brand, postId: number): Promise<string | null> {
  const pair = await editPairForPost(workspaceId, postId);
  if (!pair) return null;
  const out = await generateText(
    { workspaceId, brandId: brand.id, purpose: "edit_lesson", subject: { type: "post", id: postId } },
    {
      system: `You study how the ${brand.name} team edits AI-written social posts and write down their preferences as short rules.`,
      prompt: editLessonPrompt(pair),
      json: true,
      temperature: 0.2,
    },
  );
  const lesson = lessonSchema.parse(parseJsonObject(out.text));
  const rule = lesson.rule.trim();
  if (!lesson.general || rule.length < 8) return null;
  const saved = await rememberFeedback(workspaceId, brand.id, rule, "editor");
  return saved?.text ?? null;
}
