import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { createBrand } from "@/lib/data";
import { clicksByPost, clicksSince, recordClick, swapLinks, trackedUrl, trackingBase, withUtm } from "@/lib/links";
import {
  brandByLeadCode, createLead, followUpText, leadCodeFor, LeadError, leadsSince, listLeads, newLeadCount, normalisePhone, updateLead, whatsappLink,
} from "@/lib/leads";
import { GET as redirectRoute } from "@/app/r/[code]/route";
import { freshDb, makeWorkspace } from "./helpers";

describe("tracking links: rules", () => {
  it("adds UTM tags once and keeps links the owner already tagged", () => {
    const u = new URL(withUtm("https://shop.in/offer", { source: "instagram", campaign: "Diwali Sweets 50% off!", content: "post-7" }));
    expect(u.searchParams.get("utm_source")).toBe("instagram");
    expect(u.searchParams.get("utm_medium")).toBe("social");
    expect(u.searchParams.get("utm_campaign")).toBe("diwali-sweets-50-off");
    expect(u.searchParams.get("utm_content")).toBe("post-7");
    expect(withUtm("https://shop.in/?utm_source=bio", { source: "x" })).toBe("https://shop.in/?utm_source=bio");
    expect(withUtm("not a link", { source: "x" })).toBe("not a link");
  });

  it("counts clicks only on a public https address", () => {
    expect(trackingBase({ APP_URL: "http://localhost:3000" })).toBeNull();
    expect(trackingBase({ APP_URL: "https://agent.f9tech.com/" })).toBe("https://agent.f9tech.com");
  });

  it("swaps the business link inside a caption for the tracked one", () => {
    expect(swapLinks("Order now: https://shop.in/offer today", ["https://shop.in/offer"], "https://a.co/r/x1")).toBe("Order now: https://a.co/r/x1 today");
    expect(swapLinks("Visit https://shop.in/", ["", "https://shop.in"], "T")).toBe("Visit T");
    expect(swapLinks("No link here", ["https://shop.in"], "T")).toBe("No link here");
  });
});

describe("tracking links: counting", () => {
  beforeEach(async () => {
    await freshDb();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("gives each post and channel one short link, counts clicks and redirects", async () => {
    vi.stubEnv("APP_URL", "https://agent.example.com");
    const { ws } = await makeWorkspace("Links");
    const brand = await createBrand(ws.id, { name: "Shop", colors: [], platforms: ["telegram"] });
    const input = { workspaceId: ws.id, brandId: brand.id, postId: 42, platform: "telegram", target: "https://shop.in/offer", campaignTheme: "Diwali" };
    const short = await trackedUrl(input);
    expect(short).toMatch(/^https:\/\/agent\.example\.com\/r\/[\w-]{8}$/);
    expect(await trackedUrl(input)).toBe(short); // the same post + channel reuses its link
    expect(await trackedUrl({ ...input, platform: "facebook" })).not.toBe(short);

    const code = short.split("/r/")[1];
    const res = await redirectRoute(new Request(short), { params: Promise.resolve({ code }) });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^https:\/\/shop\.in\/offer\?utm_source=telegram/);
    await recordClick(code);
    expect((await clicksByPost(ws.id)).get(42)).toBe(2);
    expect(await clicksSince(ws.id, brand.id, new Date(Date.now() - 60_000))).toBe(2);
    const missing = await redirectRoute(new Request("https://x/r/nope1234"), { params: Promise.resolve({ code: "nope1234" }) });
    expect(missing.status).toBe(404);
  });

  it("keeps the tagged link when running locally", async () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    const { ws } = await makeWorkspace("Local");
    const brand = await createBrand(ws.id, { name: "Shop", colors: [], platforms: [] });
    const link = await trackedUrl({ workspaceId: ws.id, brandId: brand.id, postId: 1, platform: "instagram", target: "https://shop.in" });
    expect(link).toMatch(/^https:\/\/shop\.in\/\?utm_source=instagram/);
    const db = await getDb();
    expect(await db.select().from(schema.links)).toHaveLength(0);
  });
});

describe("leads", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("cleans phone numbers and builds WhatsApp links", () => {
    expect(normalisePhone("98765 43210")).toBe("919876543210");
    expect(normalisePhone("098765-43210")).toBe("919876543210");
    expect(normalisePhone("+1 415 555 0100")).toBe("14155550100");
    expect(normalisePhone("123")).toBeNull();
    expect(whatsappLink("9876543210", "Hi Ravi")).toBe("https://wa.me/919876543210?text=Hi%20Ravi");
    expect(whatsappLink(null, "x")).toBeNull();
    expect(followUpText({ name: "Bright Tutors" }, { name: "Ravi Kumar", message: "Maths for class 10" })).toBe(
      'Hi Ravi, thank you for your enquiry about "Maths for class 10". This is Bright Tutors. When is a good time to talk?',
    );
  });

  it("takes enquiries through the enquiry page code, merges repeats, and moves them along", async () => {
    const { ws } = await makeWorkspace("Leads");
    const brand = await createBrand(ws.id, { name: "Bright Tutors", colors: [], platforms: [] });
    const code = await leadCodeFor(ws.id, brand.id);
    expect(code).toMatch(/^[\w-]{7}$/);
    expect(await leadCodeFor(ws.id, brand.id)).toBe(code); // stable
    expect((await brandByLeadCode(code))?.id).toBe(brand.id);
    expect(await brandByLeadCode("../../x")).toBeNull();

    await expect(createLead(ws.id, brand.id, { name: "R" })).rejects.toThrow(LeadError);
    await expect(createLead(ws.id, brand.id, { name: "Ravi" })).rejects.toThrow(/phone number or an email/);
    await expect(createLead(ws.id, brand.id, { name: "Ravi", phone: "12" })).rejects.toThrow(/phone number/);
    const a = await createLead(ws.id, brand.id, { name: "Ravi", phone: "9876543210", message: "Maths class 10", source: "instagram" });
    const again = await createLead(ws.id, brand.id, { name: "Ravi", phone: "9876543210", message: "again" });
    expect(again.id).toBe(a.id); // same person within an hour = one lead
    await createLead(ws.id, brand.id, { name: "Sita", email: "sita@example.com" });

    expect(await newLeadCount(ws.id)).toBe(2);
    expect(await leadsSince(ws.id, brand.id, new Date(Date.now() - 60_000))).toBe(2);
    await updateLead(ws.id, a.id, { status: "won", notes: "Joined the batch" });
    await updateLead(ws.id, a.id, { status: "bogus" }); // ignored
    const won = await listLeads(ws.id, { status: "won" });
    expect(won.map((r) => [r.lead.name, r.lead.notes, r.brandName])).toEqual([["Ravi", "Joined the batch", "Bright Tutors"]]);
    expect(await newLeadCount(ws.id)).toBe(1);

    const other = await makeWorkspace("Other");
    expect(await updateLead(other.ws.id, a.id, { status: "lost" })).toBeNull(); // never across workspaces
    const db = await getDb();
    const [row] = await db.select().from(schema.leads).where(eq(schema.leads.id, a.id));
    expect(row.status).toBe("won");
  });
});
