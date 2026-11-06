import { z } from "zod";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Brand, Comment } from "@/db/schema";
import { decryptSecret } from "@/lib/secrets";
import { brandSystemPromptWithMemory } from "./brand-context";
import { parseJsonObject } from "./json";
import { generateText, QuotaExceededError } from "./router";
import { graph, pageToken } from "./publish/meta";
import type { ChannelAuth } from "./publish/types";

/*
 * Community manager: reads new comments on the posts the app published (Facebook Page and
 * Instagram), sorts each one (question / praise / complaint / spam) and drafts a reply in the
 * brand's voice. A person sends, edits or skips each reply in the Inbox; spam is skipped.
 */

export const COMMUNITY_PLATFORMS = ["facebook", "instagram"] as const;
export const RUN_EVERY_MS = 30 * 60_000;
const LOOK_BACK_DAYS = 14; // comments on older posts are rare; stop polling them
const MAX_DRAFTS_PER_RUN = 12; // keep free AI quota for content

export type RawComment = { id: string; author: string; authorId?: string; text: string; at: string | null };

/** New comments on one published post. */
export async function fetchComments(platform: string, auth: ChannelAuth, externalId: string): Promise<RawComment[]> {
  if (platform === "facebook") {
    const token = await pageToken(auth);
    const out = await graph("GET", `${externalId}/comments`, token, { fields: "id,from{id,name},message,created_time", limit: "50", order: "reverse_chronological" });
    return ((out.data as Record<string, unknown>[]) ?? [])
      .map((c) => {
        const from = (c.from ?? {}) as Record<string, string>;
        return { id: String(c.id), author: from.name ?? "Someone", authorId: from.id, text: String(c.message ?? ""), at: (c.created_time as string) ?? null };
      })
      .filter((c) => c.text.trim() && c.authorId !== auth.config.pageId); // not the Page's own replies
  }
  if (platform === "instagram") {
    const out = await graph("GET", `${externalId}/comments`, auth.token, { fields: "id,text,username,timestamp", limit: "50" });
    const own = (auth.config.username ?? "").toLowerCase();
    return ((out.data as Record<string, unknown>[]) ?? [])
      .map((c) => ({ id: String(c.id), author: String(c.username ?? "someone"), text: String(c.text ?? ""), at: (c.timestamp as string) ?? null }))
      .filter((c) => c.text.trim() && (!own || c.author.toLowerCase() !== own));
  }
  return [];
}

/** Post a reply under a comment. */
export async function sendReply(platform: string, auth: ChannelAuth, commentId: string, text: string): Promise<void> {
  if (platform === "facebook") {
    await graph("POST", `${commentId}/comments`, await pageToken(auth), { message: text });
  } else if (platform === "instagram") {
    await graph("POST", `${commentId}/replies`, auth.token, { message: text });
  } else {
    throw new Error(`Replies are not supported on ${platform}`);
  }
}

export function replyPrompt(brand: Pick<Brand, "name" | "website">, c: Pick<Comment, "author" | "text" | "platform">, postCaption: string | null): string {
  return [
    "TASK: COMMENT_REPLY",
    `PLATFORM: ${c.platform}`,
    postCaption ? `OUR POST: ${postCaption.slice(0, 400)}` : "",
    `COMMENT BY ${c.author ?? "someone"}: ${c.text.slice(0, 600)}`,
    "",
    "You manage this brand's social media comments. Classify the comment and write the reply.",
    "- intent: question | praise | complaint | spam | other. Spam = ads, scams, links to other businesses, gibberish.",
    "- reply: 1-2 short, warm sentences in the brand's voice and the comment's language. Use the person's first name if it looks like a real name.",
    "- Answer questions only with facts from the brand key facts; if the answer is not there, invite them to message us"
      + (brand.website ? ` or visit ${brand.website}` : "") + ".",
    "- Complaints: apologise, do not argue, ask them to message us so we can fix it.",
    "- Never promise prices, discounts or dates that are not in the key facts. No hashtags. At most one emoji.",
    "- For spam, reply is empty.",
    'Reply with JSON only: {"intent": "question", "reply": "..."}',
  ]
    .filter(Boolean)
    .join("\n");
}

const draftSchema = z.object({ intent: z.string().default("other"), reply: z.string().default("") });
const INTENTS = ["question", "praise", "complaint", "spam", "other"];

/** Read new comments for one brand and draft replies. Returns how many new comments were found. */
export async function runCommunity(workspaceId: number, brandId: number, now = new Date()): Promise<{ found: number; drafted: number }> {
  const db = await getDb();
  const [brand] = await db.select().from(schema.brands).where(and(eq(schema.brands.workspaceId, workspaceId), eq(schema.brands.id, brandId)));
  if (!brand) return { found: 0, drafted: 0 };
  const pubs = await db
    .select({ pub: schema.publications, channel: schema.channels })
    .from(schema.publications)
    .innerJoin(schema.channels, eq(schema.channels.id, schema.publications.channelId))
    .where(
      and(
        eq(schema.publications.workspaceId, workspaceId),
        eq(schema.channels.brandId, brandId),
        eq(schema.publications.status, "sent"),
        isNotNull(schema.publications.externalId),
        inArray(schema.publications.platform, [...COMMUNITY_PLATFORMS]),
        gte(schema.publications.publishedAt, new Date(now.getTime() - LOOK_BACK_DAYS * 86400000)),
      ),
    );
  let found = 0;
  for (const { pub, channel } of pubs) {
    let list: RawComment[] = [];
    try {
      const config = { ...channel.config, username: channel.config.username ?? channel.name.replace(/^@/, "") };
      list = await fetchComments(pub.platform, { token: decryptSecret(channel.secret), config }, pub.externalId!);
    } catch {
      continue; // one post failing (deleted, permission) must not stop the others
    }
    for (const c of list) {
      const inserted = await db
        .insert(schema.comments)
        .values({ workspaceId, brandId, publicationId: pub.id, postId: pub.postId, platform: pub.platform, externalId: c.id, author: c.author.slice(0, 200), text: c.text.slice(0, 4000), commentedAt: c.at ? new Date(c.at) : null })
        .onConflictDoNothing()
        .returning({ id: schema.comments.id });
      found += inserted.length;
    }
  }
  const drafted = await draftReplies(workspaceId, brand);
  await db.update(schema.brands).set({ communityLastRunAt: now }).where(eq(schema.brands.id, brandId));
  return { found, drafted };
}

/** Draft replies for comments that have none yet (oldest first, a few per run). */
export async function draftReplies(workspaceId: number, brand: Brand): Promise<number> {
  const db = await getDb();
  const todo = await db
    .select({ c: schema.comments, caption: schema.posts.caption })
    .from(schema.comments)
    .leftJoin(schema.posts, eq(schema.posts.id, schema.comments.postId))
    .where(and(eq(schema.comments.workspaceId, workspaceId), eq(schema.comments.brandId, brand.id), eq(schema.comments.status, "new")))
    .orderBy(schema.comments.id)
    .limit(MAX_DRAFTS_PER_RUN);
  if (!todo.length) return 0;
  const system = await brandSystemPromptWithMemory(brand);
  let n = 0;
  for (const { c, caption } of todo) {
    try {
      const out = await generateText({ workspaceId, brandId: brand.id, purpose: "comment_reply", subject: { type: "comment", id: c.id } }, { system, prompt: replyPrompt(brand, c, caption), json: true, temperature: 0.5 });
      const d = draftSchema.parse(parseJsonObject(out.text));
      const intent = INTENTS.includes(d.intent) ? d.intent : "other";
      const reply = d.reply.trim().slice(0, 1000);
      await db
        .update(schema.comments)
        .set({ intent, reply: reply || null, status: intent === "spam" || !reply ? "skipped" : "drafted" })
        .where(eq(schema.comments.id, c.id));
      n++;
    } catch (err) {
      if (err instanceof QuotaExceededError) break; // try again next run
    }
  }
  return n;
}

/** Send one reply (optionally edited by the person first). */
export async function sendCommentReply(workspaceId: number, commentId: number, text?: string): Promise<Comment> {
  const db = await getDb();
  const [c] = await db.select().from(schema.comments).where(and(eq(schema.comments.workspaceId, workspaceId), eq(schema.comments.id, commentId)));
  if (!c) throw new Error("Comment not found");
  if (c.status === "sent") return c;
  const reply = (text ?? c.reply ?? "").trim().slice(0, 1000);
  if (!reply) throw new Error("Write a reply first");
  const [row] = c.publicationId
    ? await db.select({ channel: schema.channels }).from(schema.publications).innerJoin(schema.channels, eq(schema.channels.id, schema.publications.channelId)).where(eq(schema.publications.id, c.publicationId))
    : [];
  if (!row) throw new Error("The channel for this post was removed");
  try {
    await sendReply(c.platform, { token: decryptSecret(row.channel.secret), config: row.channel.config }, c.externalId, reply);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const [failed] = await db.update(schema.comments).set({ status: "failed", reply, error: msg.slice(0, 500) }).where(eq(schema.comments.id, c.id)).returning();
    return failed;
  }
  const [sent] = await db.update(schema.comments).set({ status: "sent", reply, error: null, repliedAt: new Date() }).where(eq(schema.comments.id, c.id)).returning();
  return sent;
}

export async function skipComment(workspaceId: number, commentId: number) {
  const db = await getDb();
  await db.update(schema.comments).set({ status: "skipped" }).where(and(eq(schema.comments.workspaceId, workspaceId), eq(schema.comments.id, commentId)));
}

export async function inbox(workspaceId: number, opts: { status?: string; brandId?: number } = {}) {
  const db = await getDb();
  const where = [eq(schema.comments.workspaceId, workspaceId)];
  if (opts.brandId) where.push(eq(schema.comments.brandId, opts.brandId));
  if (opts.status === "todo") where.push(inArray(schema.comments.status, ["new", "drafted", "failed"]));
  else if (opts.status) where.push(eq(schema.comments.status, opts.status));
  return db
    .select({ c: schema.comments, brandName: schema.brands.name, url: schema.publications.url, headline: schema.posts.posterHeadline })
    .from(schema.comments)
    .innerJoin(schema.brands, eq(schema.brands.id, schema.comments.brandId))
    .leftJoin(schema.publications, eq(schema.publications.id, schema.comments.publicationId))
    .leftJoin(schema.posts, eq(schema.posts.id, schema.comments.postId))
    .where(and(...where))
    .orderBy(desc(schema.comments.id))
    .limit(200);
}

export async function inboxCount(workspaceId: number): Promise<number> {
  const db = await getDb();
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.comments).where(and(eq(schema.comments.workspaceId, workspaceId), inArray(schema.comments.status, ["new", "drafted"])));
  return Number(r?.n ?? 0);
}

/** Called by the worker once a minute: brands with a Facebook / Instagram channel whose 30-minute read is due. */
export async function queueDueCommunity(now = new Date()): Promise<number> {
  const db = await getDb();
  const due = await db
    .selectDistinct({ id: schema.brands.id, workspaceId: schema.brands.workspaceId })
    .from(schema.brands)
    .innerJoin(schema.channels, and(eq(schema.channels.brandId, schema.brands.id), inArray(schema.channels.platform, [...COMMUNITY_PLATFORMS])))
    .where(or(isNull(schema.brands.communityLastRunAt), lte(schema.brands.communityLastRunAt, new Date(now.getTime() - RUN_EVERY_MS))));
  if (!due.length) return 0;
  const { enqueue } = await import("@/jobs/queue");
  for (const b of due) {
    await db.update(schema.brands).set({ communityLastRunAt: now }).where(eq(schema.brands.id, b.id));
    await enqueue("community.read", { workspaceId: b.workspaceId, brandId: b.id }, b.workspaceId);
  }
  return due.length;
}
