import { and, count, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Brand } from "@/db/schema";
import { newLeadCount } from "./leads";
import { inboxCount } from "@/agent/community";
import { planWeekFor } from "@/agent/director";

/** The dashboard's "Growth" card: leads, comments, articles and what the Director is doing this week. */
export async function growthSummary(workspaceId: number, brands: Brand[]) {
  const db = await getDb();
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [[leadsMonth], [articlesMonth], newLeads, comments] = await Promise.all([
    db.select({ n: count() }).from(schema.leads).where(and(eq(schema.leads.workspaceId, workspaceId), gte(schema.leads.createdAt, monthStart))),
    db.select({ n: count() }).from(schema.articles).where(and(eq(schema.articles.workspaceId, workspaceId), eq(schema.articles.status, "ready"), gte(schema.articles.createdAt, monthStart))),
    newLeadCount(workspaceId),
    inboxCount(workspaceId),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const directed = brands
    .filter((b) => b.marketingGoal)
    .map((b) => ({ id: b.id, name: b.name, objective: b.marketingGoal!.objective, week: planWeekFor(b.marketingPlan, today) ?? b.marketingPlan?.weeks.find((w) => w.end >= today) ?? null }));
  return { leadsMonth: Number(leadsMonth?.n ?? 0), newLeads, comments, articlesMonth: Number(articlesMonth?.n ?? 0), directed };
}
