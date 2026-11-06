import { beforeEach, describe, expect, it } from "vitest";
import { bigNumber } from "@/agent/images/poster";
import { fitText, measure } from "@/agent/images/measure";
import { imagePrompt, siteLabel, simpleLanguageRules } from "@/agent/style";
import { brandSystemPrompt } from "@/agent/brand-context";
import { batchPrompt } from "@/agent/copywriter";
import { enqueue, processJobs } from "@/jobs/queue";
import { createBrand, createCampaign, getBrand, listCampaignPosts } from "@/lib/data";
import { freshDb, makeWorkspace } from "./helpers";

describe("Brand Kit v2: text fitting", () => {
  it("fits text inside the box by shrinking, and never runs past the edge", () => {
    const long = "Which Article of the Constitution deals with the appointment and powers of the Finance Commission of India";
    const fit = fitText(long, { family: "Poppins", weight: 800 }, { maxWidth: 800, maxLines: 4, maxSize: 90, minSize: 40 });
    expect(fit.lines.length).toBeLessThanOrEqual(4);
    expect(fit.size).toBeLessThan(90);
    for (const l of fit.lines) expect(measure(l, { family: "Poppins", weight: 800, size: fit.size })).toBeLessThanOrEqual(800);
  });

  it("measures Telugu and Hindi text with the script fonts", () => {
    expect(measure("చక్రవ్యూహ్", { family: "Poppins", weight: 700, size: 60 })).toBeGreaterThan(100);
    expect(measure("नमस्ते", { family: "Inter", weight: 700, size: 60 })).toBeGreaterThan(80);
  });
});

describe("Brand Kit v2: templates", () => {
  it("finds the big number in a headline", () => {
    expect(bigNumber("199 days to Prelims 2027")).toEqual({ number: "199", rest: "days to Prelims 2027" });
    expect(bigNumber("Only ₹99 a month")?.number).toBe("₹99");
    expect(bigNumber("2,476 real past questions")?.number).toBe("2,476");
    expect(bigNumber("No numbers here")).toBeNull();
  });
});

describe("Brand Kit v2: Indian style and simple language", () => {
  const brand = {
    name: "Chakravyuh",
    description: "Free UPSC prep app",
    industry: "Education",
    colors: ["#3730a3", "#f59e0b"],
    visualStyle: "Real Indian students studying in libraries and hostels",
  };

  it("image prompts ask for India, the brand's photo style, and no text", () => {
    const p = imagePrompt(brand, "student revising notes at night", "band");
    expect(p).toContain("student revising notes at night");
    expect(p).toContain("Real Indian students studying in libraries");
    expect(p).toMatch(/Set in India/);
    expect(p).toMatch(/no text/);
    expect(p).toMatch(/upper two-thirds/); // leaves room for the band template's text
  });

  it("every writer gets simple-language rules and the brand's key facts", () => {
    const rules = simpleLanguageRules({ language: "English" }).join("\n");
    expect(rules).toMatch(/at most 12 words/);
    expect(rules).toMatch(/lakh and crore/);
    const system = brandSystemPrompt({
      id: 1, workspaceId: 1, name: "Chakravyuh", industry: null, website: null, city: null, description: null, audience: null,
      tone: null, language: "English", colors: [], fonts: [], keywords: [], hashtags: [], platforms: [], dos: null, donts: null,
      services: null, timezone: "Asia/Kolkata", logoUrl: null, logoKey: null, visualStyle: null,
      keyFacts: "2,476 real UPSC past questions\nFree, no ads", createdAt: new Date(), updatedAt: new Date(),
      autopilotEnabled: false, autopilotDay: 1, autopilotPostsPerWeek: 5, autopilotPlatforms: [], autopilotFormats: [], autopilotNextRunAt: null, autopilotLastRunAt: null,
      analystLastRunAt: null,
      seoKit: null,
    presenter: null,
    marketingGoal: null,
    marketingPlan: null,
    leadCode: null,
    communityLastRunAt: null,
    });
    expect(system).toContain("BRAND KEY FACTS");
    expect(system).toContain("2,476 real UPSC past questions");
    expect(system).toContain("LANGUAGE RULES");
  });

  it("the copywriter is told every template and asked to pick one", () => {
    const prompt = batchPrompt({ theme: "Prelims countdown", goal: null, campaignType: "general", hashtags: [] } as never, [
      { id: 1, platform: "instagram", format: "image", publishOn: "2026-11-10", angle: "countdown" } as never,
    ]);
    for (const t of ["bignumber", "tip", "question", "quote", "split", "announcement"]) expect(prompt).toContain(`${t} =`);
    expect(prompt).toContain("poster_subline");
  });

  it("shows the website without https/www in the footer", () => {
    expect(siteLabel("https://chakravyuh.upsc.guru/app")).toBe("chakravyuh.upsc.guru");
    expect(siteLabel("www.f9tech.com")).toBe("f9tech.com");
    expect(siteLabel(null)).toBeNull();
  });
});

describe("Brand Kit v2: pipeline", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("saves the new Brand Kit fields and uses the template, sub-line and kicker the writer picked", async () => {
    const { ws } = await makeWorkspace("Chakravyuh");
    const brand = await createBrand(ws.id, {
      name: "Chakravyuh", colors: ["#3730a3", "#f59e0b"], fonts: ["Poppins", "Inter"], platforms: ["instagram"],
      visualStyle: "Indian students", keyFacts: "Free, no ads",
    });
    expect(await getBrand(ws.id, brand.id)).toMatchObject({ visualStyle: "Indian students", keyFacts: "Free, no ads" });

    const campaign = await createCampaign(ws.id, {
      brandId: brand.id, theme: "Prelims countdown", platforms: ["instagram"], startDate: "2026-11-10", endDate: "2026-11-23", postsPerWeek: 2,
    });
    await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: campaign.id }, ws.id);
    await processJobs();
    const posts = await listCampaignPosts(ws.id, campaign.id);
    expect(posts.length).toBeGreaterThan(1);
    const templates = new Set(posts.map((p) => p.posterTemplate));
    expect(templates.size).toBeGreaterThan(1); // not always "band" any more
    expect(posts.some((p) => p.posterSubline)).toBe(true);
    expect(posts.some((p) => p.posterKicker)).toBe(true);
    expect(posts.every((p) => p.designStatus === "done")).toBe(true);
  });
});
