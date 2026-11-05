import { beforeEach, describe, expect, it } from "vitest";
import { checkPost, datesIn, numbersIn, qcStatusOf, type QcInput } from "@/agent/quality";
import { qualityGate } from "@/agent/quality-gate";
import { getDb, schema } from "@/db";
import { enqueue, processJobs } from "@/jobs/queue";
import { createBrand, createCampaign, getPost, listCampaignPosts, postHistory } from "@/lib/data";
import { freshDb, makeWorkspace } from "./helpers";

const brand: QcInput["brand"] = {
  name: "Chakravyuh",
  keyFacts: "2,476 real UPSC past questions\n1,449 syllabus subtopics\nFree, no ads\nUPSC Prelims 2027: 23 May 2027",
  description: "Free UPSC prep app",
  services: null,
  website: "https://chakravyuh.upsc.guru",
  city: null,
  logoKey: "logo.png",
};
const campaign: QcInput["campaign"] = {
  theme: "Prelims 2027 countdown",
  goal: null,
  keyFacts: null,
  eventDate: null,
  location: null,
  audience: null,
  callToAction: "Open the free app",
  ctaUrl: null,
};
const good: QcInput["post"] = {
  id: 1,
  platform: "instagram",
  format: "image",
  publishOn: "2026-11-05",
  angle: "countdown",
  caption: "Prelims is close. Practise 2,476 real UPSC past questions, free.\nOpen the free app today.",
  hashtags: ["#UPSC", "#UPSC2027", "#Prelims"],
  posterHeadline: "199 days to Prelims 2027",
  posterSubline: "Start today with a daily plan.",
  posterKicker: "Countdown",
  posterCta: "Open the free app",
  designStatus: "done",
  demoParts: [],
  status: "drafted",
};
const codes = (post: Partial<QcInput["post"]>, b: Partial<QcInput["brand"]> = {}) =>
  checkPost({ post: { ...good, ...post }, brand: { ...brand, ...b }, campaign }).map((i) => i.code);

describe("quality checker rules", () => {
  it("passes a clean post, including a countdown that matches a date in Key facts", () => {
    // 5 Nov 2026 -> 23 May 2027 = 199 days.
    expect(checkPost({ post: good, brand, campaign })).toEqual([]);
    expect(qcStatusOf([])).toBe("pass");
  });

  it("flags numbers that are not in Key facts or the brief, but not hashtags, links or small counts", () => {
    expect(codes({ caption: "Join 50,000 toppers. 3 tips inside. #UPSC2027 chakravyuh.upsc.guru Open the free app" })).toContain("unknown_numbers");
    const issue = checkPost({ post: { ...good, caption: "Join 50,000 toppers. Open the free app" }, brand, campaign }).find((i) => i.code === "unknown_numbers")!;
    expect(issue.message).toContain("50000");
    expect(issue.message).not.toContain("2027");
    expect(codes({ caption: "3 tips for today. #UPSC2027 Open the free app" })).not.toContain("unknown_numbers");
  });

  it("finds numbers and dates in text", () => {
    expect(numbersIn("₹1,50,000 and 95% #Top10 https://x.com/123 chakravyuh.upsc.guru")).toEqual(["150000", "95"]);
    expect(datesIn("Prelims on 23 May 2027 or May 23, 2027 or 2027-05-23")).toHaveLength(3);
  });

  it("fails risky promises and warns on hype words and long sentences", () => {
    expect(codes({ caption: "Guaranteed selection with 100% results. Open the free app" })).toContain("risky_claim");
    expect(codes({ caption: "Unlock a revolutionary way to study. Open the free app" })).toContain("hype");
    const long = "This is a very long sentence that keeps going and going with many words so that nobody can read it easily on a small phone screen at all";
    expect(codes({ caption: `${long}. Open the free app` })).toContain("long_sentences");
  });

  it("checks hashtags, the campaign CTA, the poster headline and the logo", () => {
    expect(codes({ hashtags: ["#a", "#b", "#c", "#d", "#e", "#f"] })).toContain("hashtags_over");
    expect(codes({ hashtags: ["#a"] })).toContain("hashtags_under");
    expect(codes({ caption: "Practise 2,476 real UPSC past questions.", posterCta: "Start now" })).toContain("cta_missing");
    expect(codes({ posterHeadline: "This poster headline is far too long to read in one second" })).toContain("headline_long");
    expect(codes({}, { logoKey: null })).toContain("no_logo");
    expect(codes({ demoParts: ["text"] })).toContain("demo");
  });

  it("marks fail vs warn", () => {
    const issues = checkPost({ post: { ...good, caption: "Guaranteed rank. Open the free app" }, brand, campaign });
    expect(qcStatusOf(issues)).toBe("fail");
    const tips = checkPost({ post: { ...good, hashtags: ["#a"] }, brand, campaign });
    expect(qcStatusOf(tips)).toBe("warn");
  });
});

describe("quality gate", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("checks every post after the campaign is made and saves what it found", async () => {
    const { ws } = await makeWorkspace("Chakravyuh");
    const b = await createBrand(ws.id, { name: "Chakravyuh", colors: ["#3730a3", "#f59e0b"], platforms: ["instagram"], keyFacts: "Free, no ads" });
    const c = await createCampaign(ws.id, { brandId: b.id, theme: "Diwali offer", platforms: ["instagram"], startDate: "2026-11-10", endDate: "2026-11-16", postsPerWeek: 2 });
    await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: c.id }, ws.id);
    await processJobs();
    const posts = await listCampaignPosts(ws.id, c.id);
    expect(posts.length).toBeGreaterThan(0);
    for (const p of posts) {
      expect(p.qcStatus).toBe("fail"); // demo text and the made-up "20%" from the demo writer
      expect(p.qcIssues.map((i) => i.code)).toContain("demo");
      expect(p.qcCheckedAt).toBeTruthy();
      expect(p.qcFixes).toBe(0); // never spends AI quota rewriting demo content
    }
  });

  it("trims too many hashtags by itself and records it as a new version", async () => {
    const { ws } = await makeWorkspace("Chakravyuh");
    const b = await createBrand(ws.id, { name: "Chakravyuh", colors: ["#3730a3"], platforms: ["instagram"], keyFacts: "Free, no ads", logoKey: "x" });
    const c = await createCampaign(ws.id, { brandId: b.id, theme: "Study tips", platforms: ["instagram"], startDate: "2026-11-10", endDate: "2026-11-16", postsPerWeek: 1 });
    const db = await getDb();
    const [post] = await db
      .insert(schema.posts)
      .values({
        workspaceId: ws.id, campaignId: c.id, brandId: b.id, platform: "instagram", format: "text", publishOn: "2026-11-10",
        caption: "Study one topic a day. Revise it the next morning.", status: "drafted",
        hashtags: ["#UPSC", "#IAS", "#Prelims", "#Mains", "#Study", "#Tips", "#India", "#Exam"],
      })
      .returning();
    const issues = await qualityGate(ws.id, post.id, { autoFix: false });
    const fresh = (await getPost(ws.id, post.id))!;
    expect(fresh.hashtags).toHaveLength(5);
    expect(issues.map((i) => i.code)).not.toContain("hashtags_over");
    expect(fresh.qcStatus).toBe("pass");
    expect((await postHistory(ws.id, post.id)).versions.some((v) => v.reason === "qc_fix")).toBe(true);
  });
});
