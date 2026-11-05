import { beforeEach, describe, expect, it, vi } from "vitest";

// A "real" copywriter (not the demo one) that fixes the post when told what was wrong.
const calls: string[][] = [];
vi.mock("@/agent/copywriter", async (orig) => ({
  ...(await orig<typeof import("@/agent/copywriter")>()),
  writePostCopy: vi.fn(async (_c: unknown, _b: unknown, _p: unknown, opts: { notes?: string[] } = {}) => {
    calls.push(opts.notes ?? []);
    return {
      caption: "Practise real UPSC past questions every day. Open the free app.",
      hashtags: ["#UPSC", "#Prelims", "#IAS"],
      imagePrompt: "student studying",
      seoKeywords: [],
      posterHeadline: "Practise real past questions",
      posterCta: "Open the free app",
      posterSubline: null,
      posterKicker: null,
      posterTemplate: undefined,
      demo: false,
    };
  }),
}));

import { qualityGate } from "@/agent/quality-gate";
import { getDb, schema } from "@/db";
import { createBrand, createCampaign, getPost } from "@/lib/data";
import { freshDb, makeWorkspace } from "./helpers";

describe("quality gate auto-fix", () => {
  beforeEach(async () => {
    await freshDb();
    calls.length = 0;
  });

  it("asks the copywriter to fix a failing post once, with the problems listed, then re-checks", async () => {
    const { ws } = await makeWorkspace("Chakravyuh");
    const b = await createBrand(ws.id, { name: "Chakravyuh", colors: ["#3730a3"], platforms: ["instagram"], keyFacts: "Free, no ads", logoKey: "x" });
    const c = await createCampaign(ws.id, { brandId: b.id, theme: "Study tips", platforms: ["instagram"], startDate: "2026-11-10", endDate: "2026-11-16", postsPerWeek: 1, callToAction: "Open the free app" });
    const db = await getDb();
    const [post] = await db
      .insert(schema.posts)
      .values({
        workspaceId: ws.id, campaignId: c.id, brandId: b.id, platform: "instagram", format: "text", publishOn: "2026-11-10",
        caption: "Guaranteed selection! Join 50,000 toppers. Open the free app.", status: "drafted", hashtags: ["#UPSC", "#IAS", "#Prelims"],
        posterHeadline: "Join toppers",
      })
      .returning();

    await qualityGate(ws.id, post.id);
    const fixed = (await getPost(ws.id, post.id))!;
    expect(calls).toHaveLength(1);
    expect(calls[0].join(" ")).toMatch(/guaranteed/);
    expect(calls[0].join(" ")).toMatch(/50000/);
    expect(fixed.caption).toContain("Practise real UPSC past questions");
    expect(fixed.qcFixes).toBe(1);
    expect(fixed.qcStatus).toBe("pass");

    // A person makes it bad again: the agent does not keep spending AI quota on it.
    await db.update(schema.posts).set({ caption: "Guaranteed rank. Open the free app." }).where(eqId(post.id));
    await qualityGate(ws.id, post.id);
    expect(calls).toHaveLength(1);
    expect((await getPost(ws.id, post.id))!.qcStatus).toBe("fail");
  });
});

import { eq } from "drizzle-orm";
const eqId = (id: number) => eq(schema.posts.id, id);
