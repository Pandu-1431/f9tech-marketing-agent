import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { createBrand, createCampaign, getBrand, getPost } from "@/lib/data";
import { autoApproveReady } from "@/agent/auto-approve";
import { goLiveStatus } from "@/lib/go-live";
import { planCampaigns } from "@/agent/director";
import { saveChannel } from "@/agent/publish";
import { freshDb, makeWorkspace } from "./helpers";

async function setup(autoApprove = true) {
  const { ws, user } = await makeWorkspace("GoLive");
  const brand = await createBrand(ws.id, { name: "Bright Tutors", colors: [], platforms: ["telegram"] });
  const db = await getDb();
  await db.update(schema.brands).set({ autoApprove }).where(eq(schema.brands.id, brand.id));
  const campaign = await createCampaign(ws.id, { brandId: brand.id, theme: "Exam tips", platforms: ["telegram"], startDate: "2026-11-06", endDate: "2026-11-12", postsPerWeek: 3 });
  const post = async (values: Partial<typeof schema.posts.$inferInsert>) =>
    (
      await db
        .insert(schema.posts)
        .values({ workspaceId: ws.id, campaignId: campaign.id, brandId: brand.id, platform: "telegram", format: "image", publishOn: "2026-11-07", status: "drafted", qcStatus: "pass", designStatus: "done", currentVersion: 1, caption: "Tip", ...values })
        .returning()
    )[0];
  return { ws, user, brand, campaign, db, post };
}

describe("auto-approve", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("approves finished posts that passed the check, and nothing else", async () => {
    const { ws, user, db, post } = await setup();
    const ok = await post({});
    const tips = await post({ qcStatus: "warn" });
    const failed = await post({ qcStatus: "fail" });
    const demo = await post({ demoParts: ["image"] });
    const designing = await post({ designStatus: "designing" });
    const reelMaking = await post({ format: "reel", reelStatus: "making" });
    const rejectedOnce = await post({});
    await db.insert(schema.approvals).values({ workspaceId: ws.id, postId: rejectedOnce.id, version: 1, decision: "rejected", note: null, userId: user.id });

    expect(await autoApproveReady()).toBe(2);
    expect((await getPost(ws.id, ok.id))?.status).toBe("approved");
    expect((await getPost(ws.id, tips.id))?.status).toBe("approved");
    for (const p of [failed, demo, designing, reelMaking, rejectedOnce]) expect((await getPost(ws.id, p.id))?.status).toBe("drafted");
    const [log] = await db.select().from(schema.approvals).where(eq(schema.approvals.postId, ok.id));
    expect(log).toMatchObject({ decision: "approved", userId: null }); // approved by the agent
    expect(await autoApproveReady()).toBe(0);
  });

  it("does nothing for a business that keeps approval by hand", async () => {
    const { ws, post } = await setup(false);
    const p = await post({});
    expect(await autoApproveReady()).toBe(0);
    expect((await getPost(ws.id, p.id))?.status).toBe("drafted");
  });
});

describe("go live checklist", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("counts the steps from new business to first post out", async () => {
    const { ws, brand, db, post } = await setup(false);
    let s = await goLiveStatus(ws.id, (await getBrand(ws.id, brand.id))!);
    expect(s).toMatchObject({ done: 1, channel: null, goal: false, approval: null });

    await post({});
    const ch = await saveChannel(ws.id, brand.id, "telegram", "@brighttutors", "BOT:TOKEN", { chatId: "@brighttutors" });
    await db.update(schema.brands).set({ marketingGoal: { objective: "leads", target: "", focus: "", postsPerWeek: 3 }, autoApprove: true }).where(eq(schema.brands.id, brand.id));
    s = await goLiveStatus(ws.id, (await getBrand(ws.id, brand.id))!);
    expect(s).toMatchObject({ done: 4, channel: "@brighttutors", goal: true, approval: "auto", waiting: 1, published: 0 });

    const sent = await post({ status: "published" });
    await db.insert(schema.publications).values({ workspaceId: ws.id, postId: sent.id, channelId: ch.id, platform: "telegram", version: 1, status: "sent", publishedAt: new Date() });
    s = await goLiveStatus(ws.id, (await getBrand(ws.id, brand.id))!);
    expect(s.done).toBe(5);
  });

  it("links a week started early (\"make this week now\") to its plan week", async () => {
    const { ws, brand, campaign, db } = await setup();
    await db.update(schema.campaigns).set({ source: "autopilot" }).where(eq(schema.campaigns.id, campaign.id));
    const plan = {
      summary: "", pillars: [], kpis: [], reviews: [], generatedAt: "",
      weeks: [{ start: "2026-11-09", end: "2026-11-15", theme: "Exam tips", campaignType: "general", callToAction: "", formats: [], why: "" }],
    };
    const map = await planCampaigns(ws.id, brand.id, plan);
    expect(map.get("2026-11-09")?.id).toBe(campaign.id); // started 6 Nov, plan week 9 Nov
  });
});
