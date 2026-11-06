import { beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { createBrand, createCampaign } from "@/lib/data";
import { change, headline, isMonth, monthlyReport, monthRange, previousMonth } from "@/lib/report";
import { createLead, updateLead } from "@/lib/leads";
import { freshDb, makeWorkspace } from "./helpers";

describe("monthly report: rules", () => {
  it("handles months and changes", () => {
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(previousMonth("2026-11")).toBe("2026-10");
    expect(monthRange("2026-12").to.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("2026-02")).toBe(true);
    expect(change(150, 100)).toBe(50);
    expect(change(5, 0)).toBeNull();
    expect(headline({ totals: { published: 0, reach: 0, engagement: 0, views: 0, clicks: 0, leads: 0, won: 0 }, previous: { published: 0, reach: 0, engagement: 0, views: 0, clicks: 0, leads: 0, won: 0 } })).toMatch(/Nothing was published/);
  });
});

describe("monthly report: numbers", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("adds up the month, compares with the month before and ranks the best posts", async () => {
    const { ws } = await makeWorkspace("Report");
    const brand = await createBrand(ws.id, { name: "Bright Tutors", colors: [], platforms: ["instagram"] });
    const campaign = await createCampaign(ws.id, { brandId: brand.id, theme: "Board exam tips", platforms: ["instagram"], startDate: "2026-10-01", endDate: "2026-11-30", postsPerWeek: 2 });
    const db = await getDb();
    const post = async (headlineText: string, format: string) =>
      (await db.insert(schema.posts).values({ workspaceId: ws.id, campaignId: campaign.id, brandId: brand.id, platform: "instagram", format, publishOn: "2026-11-03", status: "published", posterHeadline: headlineText, currentVersion: 1 }).returning())[0];
    const publish = async (postId: number, at: string, m: { reach: number; likes: number; views?: number }) => {
      const [pub] = await db.insert(schema.publications).values({ workspaceId: ws.id, postId, platform: "instagram", version: 1, status: "sent", publishedAt: new Date(at), url: `https://ig/${postId}` }).returning();
      await db.insert(schema.postMetrics).values({ workspaceId: ws.id, brandId: brand.id, postId, publicationId: pub.id, platform: "instagram", reach: m.reach, likes: m.likes, views: m.views ?? 0 });
    };
    const a = await post("Top 5 maths tricks", "reel");
    const b = await post("Free demo class", "image");
    const old = await post("October post", "image");
    await publish(a.id, "2026-11-03T10:00:00Z", { reach: 2000, likes: 150, views: 5000 });
    await publish(b.id, "2026-11-10T10:00:00Z", { reach: 800, likes: 20 });
    await publish(old.id, "2026-10-12T10:00:00Z", { reach: 500, likes: 50 });
    const lead = await createLead(ws.id, brand.id, { name: "Ravi", phone: "9876543210" });
    await updateLead(ws.id, lead.id, { status: "won" });

    const r = await monthlyReport(ws.id, brand, "2026-11");
    expect(r.totals).toMatchObject({ published: 2, reach: 2800, engagement: 170, views: 5000 });
    expect(r.previous).toMatchObject({ published: 1, reach: 500, engagement: 50 });
    expect(r.best.map((x) => x.headline)).toEqual(["Top 5 maths tricks", "Free demo class"]);
    expect(r.byFormat.map((f) => f.format)).toEqual(["reel", "image"]);
    expect(headline(r)).toMatch(/2 posts went out, reaching 2,800 people/);
    expect(headline(r)).toMatch(/Engagement is up 240%/);
  });
});
