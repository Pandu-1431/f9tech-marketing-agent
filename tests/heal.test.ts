import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { createBrand, createCampaign, listCampaignPosts } from "@/lib/data";
import { enqueue, processJobs } from "@/jobs/queue";
import { healStuckWork, openJobCount } from "@/jobs/heal";
import { freshDb, makeWorkspace } from "./helpers";

describe("self-healing worker", () => {
  it("restarts posts stuck on Writing / Designing / Making video with no job behind them", async () => {
    await freshDb();
    const db = await getDb();
    const { ws } = await makeWorkspace("Heal Co");
    const brand = await createBrand(ws.id, { name: "Heal Co", colors: ["#3730a3"], platforms: ["instagram"] });
    const campaign = await createCampaign(ws.id, { brandId: brand.id, theme: "Daily study plan", platforms: ["instagram"], startDate: "2026-11-02", endDate: "2026-11-08", postsPerWeek: 3 });
    await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: campaign.id }, ws.id);
    await processJobs();
    const [a, b, c] = await listCampaignPosts(ws.id, campaign.id);
    const old = new Date(Date.now() - 60 * 60_000);
    await db.update(schema.posts).set({ designStatus: "designing", updatedAt: old }).where(eq(schema.posts.id, a.id));
    await db.update(schema.posts).set({ status: "idea", updatedAt: old }).where(eq(schema.posts.id, b.id));
    await db.update(schema.posts).set({ format: "reel", reelStatus: "making", updatedAt: old }).where(eq(schema.posts.id, c.id));
    expect(await openJobCount(ws.id, campaign.id)).toBe(0);

    expect(await healStuckWork()).toBe(3);
    expect(await openJobCount(ws.id, campaign.id)).toBe(3);
    expect(await healStuckWork()).toBe(0); // never queued twice

    await processJobs();
    const after = await listCampaignPosts(ws.id, campaign.id);
    expect(after.find((p) => p.id === a.id)?.designStatus).toBe("done");
    expect(after.find((p) => p.id === b.id)?.status).toBe("drafted");
    expect(after.find((p) => p.id === c.id)?.reelStatus).toBe("done");
  });
});
