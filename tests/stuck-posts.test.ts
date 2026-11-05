import { beforeEach, describe, expect, it } from "vitest";
import { handlers } from "@/jobs/handlers";
import { getDb, schema } from "@/db";
import { createBrand, createCampaign, getPost } from "@/lib/data";
import { freshDb, makeWorkspace } from "./helpers";

describe("no post is ever stuck", () => {
  beforeEach(async () => {
    await freshDb();
  });

  async function post(values: Partial<typeof schema.posts.$inferInsert>) {
    const { ws } = await makeWorkspace("X");
    const b = await createBrand(ws.id, { name: "X", platforms: ["instagram"] });
    const c = await createCampaign(ws.id, { brandId: b.id, theme: "T", platforms: ["instagram"], startDate: "2026-11-10", endDate: "2026-11-16", postsPerWeek: 1 });
    const db = await getDb();
    const [p] = await db
      .insert(schema.posts)
      .values({ workspaceId: ws.id, campaignId: c.id, brandId: b.id, platform: "instagram", publishOn: "2026-11-10", ...values })
      .returning();
    return { ws, c, p };
  }

  it("a rewrite that gives up puts the post back with the reason, not on 'Writing…'", async () => {
    const { ws, p } = await post({ caption: "Old caption", status: "idea", designStatus: "designing", currentVersion: 1 });
    await handlers["post.rewrite"].onFinalFailure!({ workspaceId: ws.id, postId: p.id }, "No text provider could answer. gemini: busy (503)");
    const fresh = (await getPost(ws.id, p.id))!;
    expect(fresh.status).toBe("drafted");
    expect(fresh.designStatus).toBe("done");
    expect(fresh.lastError).toMatch(/busy or out of free requests/);
  });

  it("a poster job that gives up shows 'failed' with the reason", async () => {
    const { ws, c, p } = await post({ status: "drafted", designStatus: "designing" });
    await handlers["campaign.design"].onFinalFailure!({ workspaceId: ws.id, campaignId: c.id }, "getaddrinfo ENOTFOUND x");
    expect((await getPost(ws.id, p.id))!).toMatchObject({ designStatus: "failed", lastError: expect.stringMatching(/Could not reach/) });
  });
});
