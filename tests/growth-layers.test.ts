import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { brandSystemPrompt } from "@/agent/brand-context";
import { buildSeoKit, normaliseKit, searchSuggestions, seoJobState, seoKitLines, seoSeeds } from "@/agent/seo";
import { gbpSummary, myLocations, publishGoogleBusiness } from "@/agent/publish/google-business";
import { googleAuthUrl } from "@/agent/publish/youtube";
import { PublishConfigError } from "@/agent/publish/types";
import { languageCode, saveChannel } from "@/agent/publish";
import { createTrackerSheet, syncBrandSheet } from "@/agent/sheets";
import { googleService, SERVICE_SCOPES } from "@/lib/oauth";
import { toCsv, trackerRows, trackerTable } from "@/lib/tracker";
import { createBrand, createCampaign, getBrand, listCampaignPosts } from "@/lib/data";
import { enqueue, processJobs } from "@/jobs/queue";
import { freshDb, makeWorkspace } from "./helpers";

type Call = { url: string; method: string; body: string };
let calls: Call[] = [];
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });

function stubFetch(route: (c: Call) => Response | undefined) {
  calls = [];
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    const c = { url: String(input), method: init.method ?? "GET", body: typeof init.body === "string" ? init.body : String(init.body ?? "") };
    calls.push(c);
    if (c.url.includes("oauth2.googleapis.com/token")) return json({ access_token: "AT" });
    return route(c) ?? json({});
  });
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Layer 4: SEO kit", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("seeds from services, keywords and industry, with the city", () => {
    expect(seoSeeds({ services: "UPSC prelims\nMains answer writing", industry: "Education", city: "Vizag", keywords: [] })).toEqual([
      "upsc prelims",
      "upsc prelims vizag",
      "mains answer writing",
      "mains answer writing vizag",
      "education",
      "education vizag",
    ]);
  });

  it("reads Google/YouTube autocomplete and never throws", async () => {
    stubFetch((c) => (c.url.includes("ds=yt") ? json(["upsc", ["upsc prelims strategy"]]) : json(["upsc", ["UPSC Prelims 2027 date", "upsc syllabus"]])));
    expect(await searchSuggestions("upsc")).toEqual(["upsc prelims 2027 date", "upsc syllabus"]);
    expect(await searchSuggestions("upsc", "youtube")).toEqual(["upsc prelims strategy"]);
    stubFetch(() => new Response("blocked", { status: 429 }));
    expect(await searchSuggestions("upsc")).toEqual([]);
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    expect(await searchSuggestions("upsc")).toEqual([]);
  });

  it("cleans the AI's kit: hashtags get #, no spaces, no duplicates; unknown intent -> learn", () => {
    const kit = normaliseKit({ keywords: [{ phrase: " UPSC Coaching ", intent: "weird", cluster: "coaching" }], hashtag_sets: { brand: ["Chakra vyuh", "#Chakravyuh"], niche: [], local: ["##vizag"], broad: [] } }, []);
    expect(kit.keywords).toEqual([{ phrase: "upsc coaching", intent: "learn", cluster: "coaching" }]);
    expect(kit.hashtagSets.brand).toEqual(["#Chakravyuh"]);
    expect(kit.hashtagSets.local).toEqual(["#vizag"]);
  });

  it("builds and saves the kit, and every writing prompt then carries it", async () => {
    stubFetch((c) => (c.url.includes("suggestqueries") ? json(["q", ["upsc coaching in vizag", "best upsc app"]]) : undefined));
    const { ws } = await makeWorkspace("Seo");
    const brand = await createBrand(ws.id, { name: "Chakravyuh", services: "UPSC coaching", city: "Vizag" });
    expect(seoKitLines(brand.seoKit)).toEqual([]);
    await enqueue("brand.seo", { workspaceId: ws.id, brandId: brand.id }, ws.id);
    expect((await seoJobState(ws.id, brand.id)).running).toBe(true);
    await processJobs();
    expect(await seoJobState(ws.id, brand.id)).toEqual({ running: false, error: null });

    const fresh = (await getBrand(ws.id, brand.id))!;
    expect(fresh.seoKit?.suggestions).toContain("upsc coaching in vizag");
    expect(fresh.seoKit?.keywords.map((k) => k.phrase)).toContain("best upsc app");
    expect(fresh.seoKit?.hashtagSets.local).toEqual(["#Vizag"]);
    const system = brandSystemPrompt(fresh);
    expect(system).toContain("SEO KIT");
    expect(system).toContain("upsc coaching in vizag");
    expect(system).toContain("- local: #Vizag");
  });

  it("still builds a kit from the seeds when autocomplete is down", async () => {
    stubFetch((c) => (c.url.includes("suggestqueries") ? new Response("", { status: 503 }) : undefined));
    const { ws } = await makeWorkspace("Offline");
    const brand = await createBrand(ws.id, { name: "Sweets", services: "Gift boxes" });
    const kit = await buildSeoKit(ws.id, brand);
    expect(kit.suggestions).toEqual([]);
    expect(kit.keywords.length).toBeGreaterThan(0);
  });
});

describe("Google Business Profile publishing", () => {
  it("drops hashtags and keeps 1500 characters", () => {
    expect(gbpSummary("Fresh sweets today! #diwali #vizag\n\n#shoplocal #gifts")).toBe("Fresh sweets today!");
    expect(gbpSummary("x".repeat(2000))).toHaveLength(1500);
  });

  it("finds the profiles the account manages", async () => {
    stubFetch((c) => {
      if (c.url.endsWith("/v1/accounts")) return json({ accounts: [{ name: "accounts/1" }] });
      if (c.url.includes("/v1/accounts/1/locations")) return json({ locations: [{ name: "locations/9", title: "Chakravyuh Vizag" }] });
    });
    expect(await myLocations("AT")).toEqual([{ account: "accounts/1", location: "locations/9", title: "Chakravyuh Vizag" }]);
    stubFetch((c) => (c.url.endsWith("/v1/accounts") ? json({ accounts: [] }) : undefined));
    await expect(myLocations("AT")).rejects.toBeInstanceOf(PublishConfigError);
  });

  it("posts an update with photo, Learn more button and language", async () => {
    stubFetch((c) => (c.url.includes("/localPosts") ? json({ name: "accounts/1/locations/9/localPosts/77", searchUrl: "https://local.google.com/p/77" }) : undefined));
    const out = await publishGoogleBusiness(
      { token: "RT", config: { account: "accounts/1", location: "locations/9" } },
      { text: "Prelims plan is live #upsc", image: { data: Buffer.from("x"), mime: "image/png", publicUrl: "https://cdn.example/p.png" }, link: "https://chakravyuh.app", language: "te" },
    );
    expect(out).toEqual({ externalId: "accounts/1/locations/9/localPosts/77", url: "https://local.google.com/p/77" });
    const post = calls.find((c) => c.url.includes("/v4/accounts/1/locations/9/localPosts"))!;
    expect(JSON.parse(post.body)).toEqual({
      languageCode: "te",
      summary: "Prelims plan is live",
      topicType: "STANDARD",
      media: [{ mediaFormat: "PHOTO", sourceUrl: "https://cdn.example/p.png" }],
      callToAction: { actionType: "LEARN_MORE", url: "https://chakravyuh.app" },
    });
  });

  it("a project without API access is a config error (no retries)", async () => {
    stubFetch((c) => (c.url.includes("/localPosts") ? json({ error: { message: "API has not been used" } }, 403) : undefined));
    await expect(publishGoogleBusiness({ token: "RT", config: { account: "accounts/1", location: "locations/9" } }, { text: "Hi" })).rejects.toBeInstanceOf(PublishConfigError);
  });

  it("maps brand language to a code", () => {
    expect(languageCode("Telugu + English")).toBe("te");
    expect(languageCode(null)).toBe("en");
  });
});

describe("Google sign-in for three services", () => {
  it("asks only for the scope each service needs", () => {
    expect(googleService("gbp")).toBe("gbp");
    expect(googleService("evil")).toBe("youtube");
    const u = new URL(googleAuthUrl("http://x/cb", "S", SERVICE_SCOPES.sheets));
    expect(u.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
    expect(new URL(googleAuthUrl("http://x/cb", "S", SERVICE_SCOPES.gbp)).searchParams.get("scope")).toContain("business.manage");
  });
});

describe("Layer 5: tracker and Google Sheet", () => {
  beforeEach(async () => {
    await freshDb();
  });

  async function seed(name = "Tracker Co") {
    const { ws } = await makeWorkspace(name);
    const brand = await createBrand(ws.id, { name, platforms: ["instagram"] });
    const campaign = await createCampaign(ws.id, { brandId: brand.id, theme: "Prelims", platforms: ["instagram"], startDate: "2026-11-02", endDate: "2026-11-08", postsPerWeek: 2 });
    await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: campaign.id }, ws.id);
    await processJobs();
    const posts = await listCampaignPosts(ws.id, campaign.id);
    return { ws, brand, campaign, posts };
  }

  it("lists every post with its link and results, per workspace only", async () => {
    const { ws, brand, posts } = await seed();
    const { ws: other } = await makeWorkspace("Other");
    const db = await getDb();
    const [ch] = await db.insert(schema.channels).values({ workspaceId: ws.id, brandId: brand.id, platform: "instagram", name: "@x", secret: "s" }).returning();
    const [pub] = await db
      .insert(schema.publications)
      .values({ workspaceId: ws.id, postId: posts[0].id, channelId: ch.id, platform: "instagram", version: 1, status: "sent", url: "https://instagram.com/p/1" })
      .returning();
    await db.insert(schema.postMetrics).values({ workspaceId: ws.id, brandId: brand.id, postId: posts[0].id, publicationId: pub.id, platform: "instagram", reach: 500, likes: 40, comments: 3, score: "61.5" });
    await db.update(schema.posts).set({ status: "published" }).where(eq(schema.posts.id, posts[0].id));

    const rows = await trackerRows(ws.id);
    expect(rows).toHaveLength(posts.length);
    const first = rows.find((r) => r.postId === posts[0].id)!;
    expect(first).toMatchObject({ brand: "Tracker Co", campaign: "Prelims", platform: "instagram", status: "published", link: "https://instagram.com/p/1", reach: 500, likes: 40, comments: 3, score: 62 });
    expect(first.time).toMatch(/^\d{2}:\d{2}$/);
    expect(await trackerRows(ws.id, { status: "published" })).toHaveLength(1);
    expect(await trackerRows(other.id)).toEqual([]);
  });

  it("CSV quotes text and neutralises formulas", () => {
    const csv = toCsv([["Caption", "Likes"], ['=HYPERLINK("x")', 3], ["a, b", 0]]);
    expect(csv).toBe(`Caption,Likes\r\n"'=HYPERLINK(""x"")",3\r\n"a, b",0\r\n`);
  });

  it("creates the sheet and rewrites the Posts tab with RAW values", async () => {
    const { ws, brand, posts } = await seed("Sheet Co");
    stubFetch((c) => (c.url.endsWith("/v4/spreadsheets") ? json({ spreadsheetId: "SID", spreadsheetUrl: "https://docs.google.com/spreadsheets/d/SID" }) : undefined));
    const sheet = await createTrackerSheet("AT", brand.name);
    expect(sheet).toEqual({ spreadsheetId: "SID", url: "https://docs.google.com/spreadsheets/d/SID", title: "Sheet Co — post tracker" });

    await saveChannel(ws.id, brand.id, "google_sheets", sheet.title, "RT", { spreadsheetId: "SID", url: sheet.url });
    stubFetch(() => undefined);
    expect(await syncBrandSheet(ws.id, brand.id)).toBe(posts.length);
    const clear = calls.find((c) => c.url.includes(":clear"))!;
    expect(clear.url).toContain("/v4/spreadsheets/SID/values/Posts!A%3AZ:clear");
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toContain("valueInputOption=RAW");
    const values = JSON.parse(put.body).values as unknown[][];
    expect(values[0]).toEqual(trackerTable([])[0]);
    expect(values).toHaveLength(posts.length + 1);
  });

  it("a revoked sign-in is saved on the connection, not retried", async () => {
    const { ws, brand } = await seed("Revoked");
    await saveChannel(ws.id, brand.id, "google_sheets", "t", "RT", { spreadsheetId: "SID" });
    stubFetch((c) => (c.url.includes("spreadsheets") ? json({ error: { message: "forbidden" } }, 403) : undefined));
    expect(await syncBrandSheet(ws.id, brand.id)).toBe(0);
    const db = await getDb();
    const [ch] = await db.select().from(schema.channels).where(eq(schema.channels.platform, "google_sheets"));
    expect(ch.lastError).toContain("Google Sheets: forbidden");
  });
});
