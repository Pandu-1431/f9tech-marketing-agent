import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { datesThatMatter, nextRunAt, queueDueAutopilots, runAutopilot, strategistPrompt, weekFor } from "@/agent/autopilot";
import { getDb, schema } from "@/db";
import { processJobs } from "@/jobs/queue";
import { createBrand, listCampaignPosts } from "@/lib/data";
import { freshDb, makeWorkspace } from "./helpers";

describe("autopilot schedule", () => {
  const brand = { autopilotDay: 1, timezone: "Asia/Kolkata" }; // Monday, IST

  it("runs on the chosen weekday at 6 am local time", () => {
    // Thursday 5 Nov 2026, 15:30 IST -> Monday 9 Nov 06:00 IST = 00:30 UTC.
    expect(nextRunAt(brand, new Date("2026-11-05T10:00:00Z")).toISOString()).toBe("2026-11-09T00:30:00.000Z");
    // Monday 05:00 IST -> the same morning at 06:00.
    expect(nextRunAt(brand, new Date("2026-11-08T23:30:00Z")).toISOString()).toBe("2026-11-09T00:30:00.000Z");
    // Monday 07:00 IST -> next Monday.
    expect(nextRunAt(brand, new Date("2026-11-09T01:30:00Z")).toISOString()).toBe("2026-11-16T00:30:00.000Z");
    expect(weekFor(brand, new Date("2026-11-09T00:30:00Z"))).toEqual({ start: "2026-11-09", end: "2026-11-15" });
  });

  it("knows national days in the week and countdowns to the brand's key dates", () => {
    const dates = datesThatMatter({ keyFacts: "UPSC Prelims 2027: 23 May 2027" }, { start: "2026-11-09", end: "2026-11-15" });
    expect(dates.join("\n")).toContain("2026-11-14: Children's Day");
    expect(dates.join("\n")).toContain("2027-05-23");
    expect(dates.join("\n")).toContain("195 days");
  });
});

describe("autopilot run", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("plans the week when its day comes, runs the whole pipeline, and never plans a week twice", async () => {
    const { ws } = await makeWorkspace("Chakravyuh");
    const brand = await createBrand(ws.id, {
      name: "Chakravyuh", colors: ["#3730a3"], platforms: ["instagram", "facebook"], services: "Daily study plan\nPast questions",
      keyFacts: "Free, no ads", timezone: "Asia/Kolkata",
    });
    const db = await getDb();
    await db
      .update(schema.brands)
      .set({ autopilotEnabled: true, autopilotDay: 1, autopilotPostsPerWeek: 2, autopilotPlatforms: ["instagram"], autopilotFormats: ["image", "carousel"], autopilotNextRunAt: new Date("2026-11-09T00:30:00Z") })
      .where(eq(schema.brands.id, brand.id));

    expect(await queueDueAutopilots(new Date("2026-11-08T12:00:00Z"))).toBe(0); // not due yet
    expect(await queueDueAutopilots(new Date("2026-11-09T00:31:00Z"))).toBe(1);
    expect(await queueDueAutopilots(new Date("2026-11-09T00:32:00Z"))).toBe(0); // next run already booked
    const [b] = await db.select().from(schema.brands).where(eq(schema.brands.id, brand.id));
    expect(b.autopilotNextRunAt?.toISOString()).toBe("2026-11-16T00:30:00.000Z");

    await processJobs(100);
    const campaigns = await db.select().from(schema.campaigns).where(eq(schema.campaigns.brandId, brand.id));
    expect(campaigns).toHaveLength(1);
    const c = campaigns[0];
    expect(c).toMatchObject({ source: "autopilot", startDate: "2026-11-09", endDate: "2026-11-15", status: "ready", platforms: ["instagram"] });
    expect(c.theme).toContain("Children's Day"); // the strategist used the national day in that week
    const posts = await listCampaignPosts(ws.id, c.id);
    expect(posts.length).toBe(2);
    expect(posts.every((p) => ["image", "carousel"].includes(p.format))).toBe(true);
    expect(posts.every((p) => p.designStatus === "done" && p.qcStatus !== "none")).toBe(true);

    // Running the same week again (e.g. "Plan this week now" twice) does not duplicate it.
    await runAutopilot(ws.id, brand.id, { now: new Date("2026-11-09T03:00:00Z") });
    expect(await db.select().from(schema.campaigns).where(eq(schema.campaigns.brandId, brand.id))).toHaveLength(1);
  });

  it("tells the strategist what was posted recently", async () => {
    const { ws } = await makeWorkspace("X");
    const brand = await createBrand(ws.id, { name: "X", platforms: ["instagram"] });
    const prompt = strategistPrompt(brand, { start: "2026-11-02", end: "2026-11-08" }, ["Old theme A"]);
    expect(prompt).toContain("Old theme A");
    expect(prompt).toContain("TASK: WEEKLY_THEME");
  });
});
