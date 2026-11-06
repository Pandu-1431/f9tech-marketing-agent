import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { BrandMemory, MemoryTopic } from "@/db/schema";

/*
 * Brand memory: what the AI team has learned about one brand, and the rules people gave it.
 * The Analyst writes learnings from post results, reviewers add feedback by rejecting a post
 * with a note, and a person can add lines by hand. Every strategist, planner, copywriter and
 * reel-script prompt reads this memory, so the team gets better week after week.
 *
 * Always per workspace + brand: one customer's learnings never reach another customer.
 */

export type MemoryKind = "learning" | "feedback" | "fact";
export type MemorySource = "analyst" | "reviewer" | "editor" | "director" | "user";

export type MemoryInput = {
  kind: MemoryKind;
  topic?: MemoryTopic;
  text: string;
  data?: Record<string, unknown>;
  source?: MemorySource;
  weight?: number;
};

const MAX_FEEDBACK = 12; // standing reviewer rules kept per brand
const MAX_PROMPT_LINES = 14; // what a prompt may carry (keeps free-tier prompts short)

const clean = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 300);

/** Everything the brand remembers (active lines, strongest evidence first). */
export async function listMemory(workspaceId: number, brandId: number, opts: { all?: boolean } = {}): Promise<BrandMemory[]> {
  const db = await getDb();
  const where = opts.all
    ? and(eq(schema.memory.workspaceId, workspaceId), eq(schema.memory.brandId, brandId))
    : and(eq(schema.memory.workspaceId, workspaceId), eq(schema.memory.brandId, brandId), eq(schema.memory.active, true));
  return db.select().from(schema.memory).where(where).orderBy(desc(schema.memory.weight), desc(schema.memory.id));
}

/** Add one line to the brand's memory. */
export async function remember(workspaceId: number, brandId: number, input: MemoryInput): Promise<BrandMemory> {
  const db = await getDb();
  const text = clean(input.text);
  if (!text) throw new Error("Memory text is empty");
  const [row] = await db
    .insert(schema.memory)
    .values({
      workspaceId,
      brandId,
      kind: input.kind,
      topic: input.topic ?? "note",
      text,
      data: input.data ?? {},
      source: input.source ?? (input.kind === "learning" ? "analyst" : "user"),
      weight: Math.max(1, Math.round(input.weight ?? 1)),
    })
    .returning();
  return row;
}

/** Forget one line (keeps the row for history; prompts no longer see it). */
export async function forget(workspaceId: number, id: number): Promise<void> {
  const db = await getDb();
  await db.update(schema.memory).set({ active: false, updatedAt: new Date() }).where(and(eq(schema.memory.workspaceId, workspaceId), eq(schema.memory.id, id)));
}

/**
 * Replace every Analyst learning of a brand with a fresh set (the Analyst runs this after each
 * read of the results). Older learnings are kept inactive so a person can see the history.
 */
export async function replaceLearnings(workspaceId: number, brandId: number, learnings: Omit<MemoryInput, "kind" | "source">[]): Promise<number> {
  const db = await getDb();
  await db
    .update(schema.memory)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(schema.memory.workspaceId, workspaceId), eq(schema.memory.brandId, brandId), eq(schema.memory.kind, "learning"), eq(schema.memory.source, "analyst"), eq(schema.memory.active, true)));
  let n = 0;
  for (const l of learnings) {
    if (!clean(l.text)) continue;
    await remember(workspaceId, brandId, { ...l, kind: "learning", source: "analyst" });
    n++;
  }
  return n;
}

/**
 * A reviewer rejected a post with a note: keep it as a standing rule ("Don't mention prices",
 * "Too formal, write like a friend"). Only the newest MAX_FEEDBACK rules stay active.
 * Also used for rules learned from a person's edits (source "editor").
 */
export async function rememberFeedback(
  workspaceId: number,
  brandId: number,
  note: string | null | undefined,
  source: Extract<MemorySource, "reviewer" | "editor"> = "reviewer",
): Promise<BrandMemory | null> {
  const text = clean(note ?? "");
  if (text.length < 4) return null;
  const db = await getDb();
  const existing = await db
    .select()
    .from(schema.memory)
    .where(and(eq(schema.memory.workspaceId, workspaceId), eq(schema.memory.brandId, brandId), eq(schema.memory.kind, "feedback"), eq(schema.memory.active, true)))
    .orderBy(desc(schema.memory.id));
  const same = existing.find((m) => m.text.toLowerCase() === text.toLowerCase());
  if (same) {
    // Said twice = twice as important.
    const [row] = await db.update(schema.memory).set({ weight: same.weight + 1, updatedAt: new Date() }).where(eq(schema.memory.id, same.id)).returning();
    return row;
  }
  const row = await remember(workspaceId, brandId, { kind: "feedback", topic: "note", text, source });
  const extra = existing.slice(MAX_FEEDBACK - 1).map((m) => m.id);
  if (extra.length) await db.update(schema.memory).set({ active: false, updatedAt: new Date() }).where(inArray(schema.memory.id, extra));
  return row;
}

/** Memory lines ready to paste into a prompt (empty when the brand has learned nothing yet). */
export function memoryBlock(rows: Pick<BrandMemory, "kind" | "text" | "weight">[]): string[] {
  if (!rows.length) return [];
  const feedback = rows.filter((r) => r.kind === "feedback");
  const learnings = rows.filter((r) => r.kind === "learning");
  const facts = rows.filter((r) => r.kind === "fact");
  const out: string[] = ["", "BRAND MEMORY (what this brand's team has learned; follow it unless the brief says otherwise):"];
  if (feedback.length) {
    out.push("Rules from the reviewer (a person said this; always obey):");
    out.push(...feedback.slice(0, 6).map((r) => `- ${r.text}`));
  }
  if (learnings.length) {
    out.push("What the results show (prefer what worked, avoid what did not):");
    out.push(...learnings.slice(0, MAX_PROMPT_LINES - Math.min(6, feedback.length)).map((r) => `- ${r.text}`));
  }
  if (facts.length) {
    out.push("Notes from the team:");
    out.push(...facts.slice(0, 4).map((r) => `- ${r.text}`));
  }
  return out;
}

/** Loads the brand's memory once (per job) and returns the prompt lines. */
export async function memoryLines(workspaceId: number, brandId: number): Promise<string[]> {
  try {
    return memoryBlock(await listMemory(workspaceId, brandId));
  } catch {
    return []; // memory is a bonus, never a reason to stop generating
  }
}

/** The best posting hour per platform the Analyst found ("time" learnings), e.g. { instagram: "19:00" }. */
export function bestTimes(rows: Pick<BrandMemory, "topic" | "data" | "active">[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.topic !== "time" || !r.active) continue;
    const d = r.data as { platform?: string; time?: string };
    if (d.platform && d.time && /^\d{2}:\d{2}$/.test(d.time)) out[d.platform] = d.time;
  }
  return out;
}

/** Formats that work best per platform from "format" learnings, e.g. { instagram: "reel" }. */
export function bestFormats(rows: Pick<BrandMemory, "topic" | "data" | "active">[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.topic !== "format" || !r.active) continue;
    const d = r.data as { platform?: string; format?: string };
    if (d.platform && d.format) out[d.platform] = d.format;
  }
  return out;
}
