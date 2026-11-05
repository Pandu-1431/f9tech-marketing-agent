import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

/*
 * The AI marketing team as people see it: six agents, each with what it is doing now,
 * how much it did today and its last piece of work. Read from the job queue and the
 * generations log (both are per workspace, so nothing leaks between workspaces).
 */

export type AgentKey = "strategist" | "copywriter" | "designer" | "video" | "checker" | "publisher";

export const AGENTS: { key: AgentKey; name: string; role: string; emoji: string; color: string; jobs: string[]; purposes: string[] }[] = [
  { key: "strategist", name: "Strategist", role: "Picks the weekly theme and plans the calendar", emoji: "🧭", color: "#6366f1", jobs: ["autopilot.run", "campaign.plan"], purposes: ["weekly_theme", "campaign_plan"] },
  { key: "copywriter", name: "Copywriter", role: "Writes captions, hashtags and poster lines", emoji: "✍️", color: "#8b5cf6", jobs: ["campaign.write", "post.rewrite"], purposes: ["post_copy", "post_copy_batch"] },
  { key: "designer", name: "Poster designer", role: "Makes on-brand posters in Indian style", emoji: "🎨", color: "#db2777", jobs: ["campaign.design", "post.design"], purposes: ["post_background"] },
  { key: "video", name: "Video maker", role: "Turns posts into reels with voice and music", emoji: "🎬", color: "#f59e0b", jobs: ["post.reel"], purposes: ["reel_script", "reel_scene", "reel_voiceover", "reel"] },
  { key: "checker", name: "Quality checker", role: "Checks spelling, brand rules and safe zones", emoji: "🛡️", color: "#10b981", jobs: [], purposes: [] },
  { key: "publisher", name: "Publisher", role: "Posts approved work on time, everywhere", emoji: "🚀", color: "#0ea5e9", jobs: ["post.publish"], purposes: [] },
];

export type AgentStatus = {
  key: AgentKey;
  name: string;
  role: string;
  emoji: string;
  color: string;
  working: boolean;
  waiting: number;
  doneToday: number;
  lastAt: Date | null;
};

export type ActivityItem = { id: number; agent: AgentKey; text: string; ok: boolean; at: Date; provider: string };

const PURPOSE_TEXT: Record<string, string> = {
  weekly_theme: "picked this week's theme",
  campaign_plan: "planned a content calendar",
  post_copy: "wrote a post",
  post_copy_batch: "wrote a batch of posts",
  post_background: "made a poster image",
  reel_script: "wrote a reel script",
  reel_scene: "made a reel scene",
  reel_voiceover: "recorded a voiceover",
  reel: "finished a reel video",
};

function agentForPurpose(purpose: string): AgentKey {
  return AGENTS.find((a) => a.purposes.includes(purpose))?.key ?? "copywriter";
}

export async function teamStatus(workspaceId: number): Promise<{ agents: AgentStatus[]; activity: ActivityItem[]; anyWorking: boolean }> {
  const db = await getDb();
  const since = new Date(Date.now() - 24 * 3600_000);

  const [jobRows, genRows, checked, published, recent] = await Promise.all([
    db
      .select({ type: schema.jobs.type, status: schema.jobs.status, n: sql<number>`count(*)::int` })
      .from(schema.jobs)
      .where(and(eq(schema.jobs.workspaceId, workspaceId), inArray(schema.jobs.status, ["queued", "running"])))
      .groupBy(schema.jobs.type, schema.jobs.status),
    db
      .select({ purpose: schema.generations.purpose, n: sql<number>`count(*)::int`, last: sql<string>`max(${schema.generations.createdAt})` })
      .from(schema.generations)
      .where(and(eq(schema.generations.workspaceId, workspaceId), eq(schema.generations.status, "ok"), gte(schema.generations.createdAt, since)))
      .groupBy(schema.generations.purpose),
    db
      .select({ n: sql<number>`count(*)::int`, last: sql<string>`max(${schema.posts.updatedAt})` })
      .from(schema.posts)
      .where(and(eq(schema.posts.workspaceId, workspaceId), sql`${schema.posts.qcStatus} <> 'none'`, gte(schema.posts.updatedAt, since))),
    db
      .select({ n: sql<number>`count(*)::int`, last: sql<string>`max(${schema.publications.publishedAt})` })
      .from(schema.publications)
      .where(and(eq(schema.publications.workspaceId, workspaceId), eq(schema.publications.status, "sent"), gte(schema.publications.publishedAt, since))),
    db
      .select({
        id: schema.generations.id,
        purpose: schema.generations.purpose,
        status: schema.generations.status,
        provider: schema.generations.provider,
        createdAt: schema.generations.createdAt,
      })
      .from(schema.generations)
      .where(eq(schema.generations.workspaceId, workspaceId))
      .orderBy(desc(schema.generations.id))
      .limit(14),
  ]);

  const agents: AgentStatus[] = AGENTS.map((a) => {
    const running = jobRows.filter((j) => a.jobs.includes(j.type) && j.status === "running").reduce((s, j) => s + Number(j.n), 0);
    const waiting = jobRows.filter((j) => a.jobs.includes(j.type) && j.status === "queued").reduce((s, j) => s + Number(j.n), 0);
    let doneToday = 0;
    let lastAt: Date | null = null;
    for (const g of genRows.filter((r) => a.purposes.includes(r.purpose))) {
      doneToday += Number(g.n);
      const t = g.last ? new Date(g.last) : null;
      if (t && (!lastAt || t > lastAt)) lastAt = t;
    }
    if (a.key === "checker") {
      doneToday = Number(checked[0]?.n ?? 0);
      lastAt = checked[0]?.last ? new Date(checked[0].last) : null;
    }
    if (a.key === "publisher") {
      doneToday = Number(published[0]?.n ?? 0);
      lastAt = published[0]?.last ? new Date(published[0].last) : null;
    }
    // The checker works right after the designer and the video maker.
    const working = a.key === "checker" ? false : running > 0;
    return { key: a.key, name: a.name, role: a.role, emoji: a.emoji, color: a.color, working, waiting, doneToday, lastAt };
  });
  const designerBusy = agents.find((x) => x.key === "designer")?.working;
  const checker = agents.find((x) => x.key === "checker");
  if (checker && designerBusy) checker.working = true;

  const activity: ActivityItem[] = recent.map((r) => ({
    id: r.id,
    agent: agentForPurpose(r.purpose),
    text: r.status === "ok" ? (PURPOSE_TEXT[r.purpose] ?? r.purpose.replaceAll("_", " ")) : `${PURPOSE_TEXT[r.purpose] ?? r.purpose} — ${r.provider} was busy, tried the next AI`,
    ok: r.status === "ok",
    at: r.createdAt,
    provider: r.provider,
  }));

  return { agents, activity, anyWorking: agents.some((a) => a.working || a.waiting > 0) };
}

/** "3 min ago" style, short. */
export function ago(date: Date | null, now = Date.now()): string {
  if (!date) return "not yet today";
  const s = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** "back in 2h 10m". */
export function untilText(ms: number, now = Date.now()): string {
  const m = Math.max(1, Math.round((ms - now) / 60000));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
