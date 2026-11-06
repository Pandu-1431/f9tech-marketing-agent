import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { createBrand } from "@/lib/data";
import { runAutopilot } from "@/agent/autopilot";
import { directorPlanPrompt, makeMarketingPlan, planExpired, planWeekFor, planWeeks, reviewLastWeek } from "@/agent/director";
import { listMemory } from "@/agent/memory";
import { growthSummary } from "@/lib/growth";
import { teamStatus } from "@/lib/team-status";
import { freshDb, makeWorkspace } from "./helpers";

const MONDAY_RUN = new Date("2026-11-09T00:30:00Z"); // Monday 9 Nov 2026, 06:00 IST

async function setup() {
  const { ws } = await makeWorkspace("Director");
  const brand = await createBrand(ws.id, {
    name: "Bright Tutors", colors: ["#1d4ed8"], platforms: ["instagram"], services: "Maths coaching\nScience doubts", keyFacts: "First class free", timezone: "Asia/Kolkata",
  });
  const db = await getDb();
  await db
    .update(schema.brands)
    .set({ autopilotEnabled: true, autopilotDay: 1, marketingGoal: { objective: "leads", target: "30 enquiries a month", focus: "", postsPerWeek: 3 } })
    .where(eq(schema.brands.id, brand.id));
  return { ws, brandId: brand.id, db };
}

describe("marketing director", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("plans four weeks from the next run day", () => {
    const weeks = planWeeks({ autopilotDay: 1, timezone: "Asia/Kolkata" }, new Date("2026-11-05T10:00:00Z"));
    expect(weeks.map((w) => w.start)).toEqual(["2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
    expect(weeks[0].end).toBe("2026-11-15");
    const now = planWeeks({ autopilotDay: 1, timezone: "Asia/Kolkata" }, new Date("2026-11-05T10:00:00Z"), true);
    expect(now[0].start).toBe("2026-11-05");
  });

  it("writes a plan with a content mix, four themed weeks and KPI targets", async () => {
    const { ws, brandId, db } = await setup();
    const plan = await makeMarketingPlan(ws.id, brandId, { now: new Date("2026-11-05T10:00:00Z") });
    expect(plan.weeks).toHaveLength(4);
    expect(plan.weeks[0]).toMatchObject({ start: "2026-11-09", theme: "Spotlight: Maths coaching", formats: ["image", "reel"] });
    expect(plan.pillars.reduce((a, p) => a + p.share, 0)).toBeGreaterThanOrEqual(99);
    expect(plan.kpis.length).toBeGreaterThan(0);
    const [b] = await db.select().from(schema.brands).where(eq(schema.brands.id, brandId));
    expect(b.marketingPlan?.summary).toBe(plan.summary);
    expect(planWeekFor(plan, "2026-11-10")?.start).toBe("2026-11-09"); // a day late still finds the week
    expect(planExpired(plan, "2026-12-07")).toBe(true);
    expect(planExpired(plan, "2026-11-30")).toBe(false);

    const prompt = directorPlanPrompt(b, b.marketingGoal!, planWeeks(b, new Date("2026-11-05T10:00:00Z")), { posts: 0, totals: { reach: 0, likes: 0, comments: 0, shares: 0, clicks: 0, views: 0 }, byFormat: [], byPlatform: [], best: [] }, []);
    expect(prompt).toContain("GOAL: Enquiries / leads");
    expect(prompt).toContain("Target: 30 enquiries a month");
    expect(prompt).toContain("2026-11-14: Children's Day");
    expect(prompt).toContain("no measured posts yet");
  });

  it("runs the autopilot week from the plan (theme, formats, posts per week)", async () => {
    const { ws, brandId, db } = await setup();
    const campaign = await runAutopilot(ws.id, brandId, { now: MONDAY_RUN });
    expect(campaign?.theme).toBe("Spotlight: Maths coaching");
    expect(campaign?.postsPerWeek).toBe(3);
    expect(campaign?.formats).toEqual(["image", "reel"]);
    expect(campaign?.goal).toMatch(/Goal: leads/);
    const [b] = await db.select().from(schema.brands).where(eq(schema.brands.id, brandId));
    expect(b.marketingPlan?.weeks[0].start).toBe("2026-11-09"); // the plan was written on the way
  });

  it("reviews a finished week once and teaches the team its changes", async () => {
    const { ws, brandId, db } = await setup();
    await makeMarketingPlan(ws.id, brandId, { now: new Date("2026-11-05T10:00:00Z") });
    const [b] = await db.select().from(schema.brands).where(eq(schema.brands.id, brandId));
    const review = await reviewLastWeek(ws.id, b, "2026-11-16", new Date("2026-11-16T01:00:00Z"));
    expect(review?.week).toBe("2026-11-09");
    expect(review?.text).toMatch(/No posts were published/);
    const [b2] = await db.select().from(schema.brands).where(eq(schema.brands.id, brandId));
    expect(await reviewLastWeek(ws.id, b2, "2026-11-16")).toBeNull(); // only once
    const lines = (await listMemory(ws.id, brandId)).filter((m) => m.source === "director");
    expect(lines.map((l) => l.text)).toEqual(["Approve posts early in the week so they go out on time"]);
    const all = await db.select().from(schema.memory).where(and(eq(schema.memory.brandId, brandId), eq(schema.memory.source, "director")));
    expect(all).toHaveLength(1);
  });

  it("shows the Director and the new agents on the dashboard", async () => {
    const { ws, brandId, db } = await setup();
    await makeMarketingPlan(ws.id, brandId);
    const brands = await db.select().from(schema.brands).where(eq(schema.brands.workspaceId, ws.id));
    const g = await growthSummary(ws.id, brands);
    expect(g.directed).toHaveLength(1);
    expect(g.directed[0].objective).toBe("leads");
    expect(g.directed[0].week?.theme).toBeTruthy();
    const team = await teamStatus(ws.id);
    expect(team.agents.map((a) => a.key)).toEqual(["director", "researcher", "strategist", "copywriter", "designer", "video", "checker", "publisher", "community", "blogger", "analyst"]);
    expect(team.activity.some((x) => x.agent === "director" && x.text === "wrote a 4-week marketing plan")).toBe(true);
  });
});
