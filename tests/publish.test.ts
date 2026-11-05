import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { publishTelegram } from "@/agent/publish/telegram";
import { publishFacebook, publishInstagram } from "@/agent/publish/meta";
import { PublishConfigError } from "@/agent/publish/types";
import { connectChannel, queueDuePublications, queuePublication } from "@/agent/publish";
import { getDb, schema } from "@/db";
import { processJobs } from "@/jobs/queue";
import { createBrand, createCampaign, getPost, recordPostVersion, reviewPost } from "@/lib/data";
import { newKey, putFile } from "@/lib/storage";
import { freshDb, makeWorkspace } from "./helpers";

type Call = { url: string; method: string; form?: FormData; json?: Record<string, unknown>; body?: string };
let calls: Call[] = [];

/** A fake Telegram + Meta API: answers like the real ones and records every call. */
function stubApis(overrides: (c: Call) => Response | undefined = () => undefined) {
  calls = [];
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const c: Call = { url, method: init.method ?? "GET" };
    if (init.body instanceof FormData) c.form = init.body;
    else if (typeof init.body === "string") {
      try {
        c.json = JSON.parse(init.body);
      } catch {
        c.body = init.body;
      }
    } else if (init.body instanceof URLSearchParams) c.body = init.body.toString();
    calls.push(c);
    const o = overrides(c);
    if (o) return o;
    const ok = (result: unknown) => new Response(JSON.stringify(result), { status: 200 });
    if (url.includes("api.telegram.org")) {
      if (url.endsWith("/getMe")) return ok({ ok: true, result: { username: "chakra_bot" } });
      if (url.endsWith("/getChat")) return ok({ ok: true, result: { id: -1001234, username: "chakravyuh_upsc", title: "Chakravyuh" } });
      return ok({ ok: true, result: { message_id: 42, chat: { id: -1001234, username: "chakravyuh_upsc" } } });
    }
    if (url.includes("/photos")) return ok({ id: "photo1", post_id: "page_1" });
    if (url.includes("/videos")) return ok({ id: "vid1" });
    if (url.includes("/media_publish")) return ok({ id: "ig_media_1" });
    if (url.includes("/media")) return ok({ id: "container1" });
    if (url.includes("fields=status_code")) return ok({ status_code: "FINISHED" });
    if (url.includes("fields=permalink")) return ok({ permalink: "https://instagram.com/p/abc" });
    return ok({ id: "x", name: "Chakravyuh Page" });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("channel tokens", () => {
  it("are encrypted at rest and decrypt back", () => {
    const enc = encryptSecret("123456:ABCDEF");
    expect(enc).not.toContain("ABCDEF");
    expect(decryptSecret(enc)).toBe("123456:ABCDEF");
  });
});

describe("publishers", () => {
  it("Telegram: photo with caption, and a long caption as a reply message", async () => {
    stubApis();
    const auth = { token: "T", config: { chatId: "@chakravyuh_upsc" } };
    const r = await publishTelegram(auth, { text: "Short caption", image: { data: png, mime: "image/png" } });
    expect(r).toEqual({ externalId: "42", url: "https://t.me/chakravyuh_upsc/42" });
    expect(calls[0].url).toMatch(/\/botT\/sendPhoto$/);
    expect(calls[0].form?.get("caption")).toBe("Short caption");

    stubApis();
    await publishTelegram(auth, { text: "x".repeat(1500), image: { data: png, mime: "image/png" } });
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["sendPhoto", "sendMessage"]);
    expect(calls[0].form?.get("caption")).toBeNull();
  });

  it("Telegram: a bad token is a config error (not retried)", async () => {
    stubApis(() => new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), { status: 401 }));
    await expect(publishTelegram({ token: "bad", config: { chatId: "@x" } }, { text: "hi" })).rejects.toBeInstanceOf(PublishConfigError);
  });

  it("Facebook: uploads the poster to the Page", async () => {
    stubApis();
    const r = await publishFacebook({ token: "P", config: { pageId: "123" } }, { text: "Hello", image: { data: png, mime: "image/png" } });
    expect(calls[0].url).toMatch(/\/v\d+\.\d+\/123\/photos$/);
    expect(calls[0].form?.get("message")).toBe("Hello");
    expect(calls[0].form?.get("access_token")).toBe("P");
    expect(r.url).toBe("https://www.facebook.com/page_1");
  });

  it("Instagram: needs a public https image link, then creates and publishes a container", async () => {
    stubApis();
    const auth = { token: "P", config: { igUserId: "1784" } };
    await expect(publishInstagram(auth, { text: "Hi", image: { data: png, mime: "image/png", publicUrl: "/media/x.png" } })).rejects.toBeInstanceOf(PublishConfigError);
    const r = await publishInstagram(auth, { text: "Hi", video: { data: png, mime: "video/mp4", publicUrl: "https://cdn.example.com/reel.mp4" } }, { pollMs: 1 });
    expect(calls.some((c) => c.url.includes("/1784/media") && c.body?.includes("media_type=REELS"))).toBe(true);
    expect(r).toEqual({ externalId: "ig_media_1", url: "https://instagram.com/p/abc" });
  });
});

describe("publishing pipeline", () => {
  beforeEach(async () => {
    await freshDb();
  });

  async function approvedPost(scheduledAt: Date) {
    const { ws, user } = await makeWorkspace("Chakravyuh");
    const brand = await createBrand(ws.id, { name: "Chakravyuh", platforms: ["telegram"] });
    const c = await createCampaign(ws.id, { brandId: brand.id, theme: "Tips", platforms: ["telegram"], startDate: "2026-11-10", endDate: "2026-11-16", postsPerWeek: 1 });
    const db = await getDb();
    const [post] = await db
      .insert(schema.posts)
      .values({ workspaceId: ws.id, campaignId: c.id, brandId: brand.id, platform: "telegram", format: "image", publishOn: "2026-11-10", scheduledAt, caption: "Study one topic a day.", hashtags: ["#UPSC"], status: "drafted", designStatus: "done" })
      .returning();
    const key = newKey(ws.id, "poster", "image/png");
    await putFile(key, png, "image/png");
    await db.insert(schema.assets).values({ workspaceId: ws.id, brandId: brand.id, postId: post.id, kind: "poster", storageKey: key, mime: "image/png" });
    const v = await recordPostVersion(ws.id, post.id, "caption");
    await reviewPost(ws.id, post.id, "approved", null, { userId: user.id, version: v!.version });
    return { ws, brand, post };
  }

  it("publishes the approved version at its time, once, and marks the post published", async () => {
    stubApis();
    const { ws, brand, post } = await approvedPost(new Date("2026-11-10T13:30:00Z"));
    await connectChannel(ws.id, brand.id, "telegram", "T", { chatId: "@chakravyuh_upsc" });

    expect(await queueDuePublications(new Date("2026-11-10T13:00:00Z"))).toBe(0); // not time yet
    expect(await queueDuePublications(new Date("2026-11-10T13:31:00Z"))).toBe(1);
    expect(await queueDuePublications(new Date("2026-11-10T13:32:00Z"))).toBe(0); // never queued twice
    await processJobs(10);

    const db = await getDb();
    const [pub] = await db.select().from(schema.publications).where(eq(schema.publications.postId, post.id));
    expect(pub).toMatchObject({ status: "sent", externalId: "42", url: "https://t.me/chakravyuh_upsc/42", version: 1 });
    expect((await getPost(ws.id, post.id))!.status).toBe("published");
    const send = calls.find((c) => c.url.endsWith("/sendPhoto"))!;
    expect(send.form?.get("caption")).toBe("Study one topic a day.\n\n#UPSC");
    expect(await queuePublication(ws.id, post.id)).toEqual({ reason: "Approve this version first" }); // published, not approved any more
  });

  it("a wrong token fails once with the error shown, without retrying", async () => {
    stubApis();
    const { ws, brand, post } = await approvedPost(new Date("2026-11-10T13:30:00Z"));
    await connectChannel(ws.id, brand.id, "telegram", "T", { chatId: "@chakravyuh_upsc" });
    stubApis((c) => (c.url.endsWith("/sendPhoto") ? new Response(JSON.stringify({ ok: false, description: "Forbidden: bot is not a member" }), { status: 403 }) : undefined));
    await queueDuePublications(new Date("2026-11-10T13:31:00Z"));
    await processJobs(10);
    const db = await getDb();
    const [pub] = await db.select().from(schema.publications).where(eq(schema.publications.postId, post.id));
    expect(pub.status).toBe("failed");
    expect(pub.error).toContain("bot is not a member");
    expect(pub.attempts).toBe(1);
    expect(calls.filter((c) => c.url.endsWith("/sendPhoto"))).toHaveLength(1);
  });

  it("needs a connected channel and an approved post", async () => {
    stubApis();
    const { ws, post } = await approvedPost(new Date("2026-11-10T13:30:00Z"));
    expect(await queuePublication(ws.id, post.id)).toEqual({ reason: "No telegram channel connected for this business" });
  });
});
