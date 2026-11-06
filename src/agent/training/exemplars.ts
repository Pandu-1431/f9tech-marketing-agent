import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/db";

/*
 * Exemplars = few-shot "training" without fine-tuning.
 *
 * The copywriter never saw a real post this brand liked. Now it does: before writing, it gets
 * 2-3 of the brand's own best posts as style examples. Best means, in this order:
 *   1. published and measured (highest engagement score from the Analyst),
 *   2. approved after a person edited the AI's text (the person showed the voice they want),
 *   3. approved as written.
 * Same platform first. Only the approved version is used (what the person signed off on),
 * never demo text. Per workspace + brand, so one customer's posts never reach another.
 */

export type Exemplar = {
  postId: number;
  platform: string;
  format: string;
  caption: string;
  hashtags: string[];
  posterHeadline: string | null;
  /** Why it was picked: "measured" (results), "edited" (a person rewrote it), "approved". */
  why: "measured" | "edited" | "approved";
  score: number | null;
};

const MAX_CANDIDATES = 80;
const MAX_CAPTION = 420;

const rank = (e: Exemplar) => (e.why === "measured" ? 3_000_000 + (e.score ?? 0) : e.why === "edited" ? 2_000_000 : 1_000_000);

/** All usable examples for a brand, best first (no platform filter). */
export async function listExemplars(workspaceId: number, brandId: number): Promise<Exemplar[]> {
  const db = await getDb();
  const rows = await db
    .select({ post: schema.posts, version: schema.postVersions })
    .from(schema.posts)
    .innerJoin(
      schema.postVersions,
      and(eq(schema.postVersions.postId, schema.posts.id), eq(schema.postVersions.version, schema.posts.approvedVersion)),
    )
    .where(
      and(
        eq(schema.posts.workspaceId, workspaceId),
        eq(schema.posts.brandId, brandId),
        isNotNull(schema.posts.approvedVersion),
        inArray(schema.posts.status, ["approved", "published"]),
      ),
    )
    .orderBy(desc(schema.posts.updatedAt))
    .limit(MAX_CANDIDATES);
  if (!rows.length) return [];

  const ids = rows.map((r) => r.post.id);
  const metrics = await db
    .select({ postId: schema.postMetrics.postId, score: schema.postMetrics.score })
    .from(schema.postMetrics)
    .where(and(eq(schema.postMetrics.workspaceId, workspaceId), inArray(schema.postMetrics.postId, ids)));
  const best = new Map<number, number>();
  for (const m of metrics) best.set(m.postId, Math.max(best.get(m.postId) ?? 0, Number(m.score)));

  const out: Exemplar[] = [];
  for (const { post, version } of rows) {
    const caption = (version.caption ?? "").trim();
    if (caption.length < 20 || version.demoParts.includes("text")) continue;
    const score = best.get(post.id);
    const why: Exemplar["why"] = score !== undefined && score > 0 ? "measured" : version.createdBy !== null ? "edited" : "approved";
    out.push({
      postId: post.id,
      platform: post.platform,
      format: post.format,
      caption,
      hashtags: version.hashtags ?? [],
      posterHeadline: version.posterHeadline,
      why,
      score: score ?? null,
    });
  }
  return out.sort((a, b) => rank(b) - rank(a));
}

/** Pick up to `limit` examples, same platform first, then the brand's best on any platform. */
export function pickExemplars(all: Exemplar[], platforms: string[], limit = 3): Exemplar[] {
  const want = new Set(platforms);
  const same = all.filter((e) => want.has(e.platform));
  const rest = all.filter((e) => !want.has(e.platform));
  return [...same, ...rest].slice(0, limit);
}

/** Prompt lines with the examples (empty when the brand has none yet). */
export function exemplarBlock(examples: Exemplar[]): string[] {
  if (!examples.length) return [];
  const label = { measured: "got strong results", edited: "a person edited and approved it", approved: "approved by the team" };
  return [
    "",
    "EXAMPLES OF THIS BRAND'S POSTS THAT WORKED (learn the voice, length and style; never copy them word for word, never reuse their facts unless the brief has them):",
    ...examples.map((e, i) => {
      const caption = e.caption.length > MAX_CAPTION ? `${e.caption.slice(0, MAX_CAPTION)}…` : e.caption;
      return [
        `Example ${i + 1} (${e.platform}, ${e.format}; ${label[e.why]}):`,
        e.posterHeadline ? `  poster headline: ${e.posterHeadline}` : "",
        `  caption: ${caption.replace(/\n+/g, " / ")}`,
        e.hashtags.length ? `  hashtags: ${e.hashtags.slice(0, 8).join(" ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }),
  ];
}

/** Loads and formats examples for these platforms. Never throws: examples are a bonus. */
export async function exemplarLines(workspaceId: number, brandId: number, platforms: string[], limit = 3): Promise<string[]> {
  try {
    return exemplarBlock(pickExemplars(await listExemplars(workspaceId, brandId), platforms, limit));
  } catch {
    return [];
  }
}
