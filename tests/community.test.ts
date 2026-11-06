import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { getDb, schema } from "@/db";
import { createBrand, createCampaign } from "@/lib/data";
import { saveChannel } from "@/agent/publish";
import { inbox, inboxCount, queueDueCommunity, replyPrompt, runCommunity, sendCommentReply, skipComment } from "@/agent/community";
import { freshDb, makeWorkspace } from "./helpers";

// A stand-in Graph API: comments on two posts, and it records the replies we send.
const sent: { path: string; body: string }[] = [];
let server: http.Server;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url!, "http://x");
    const json = (o: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(o));
    if (req.method === "POST") {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        sent.push({ path: u.pathname, body });
        json({ id: "reply-1" });
      });
      return;
    }
    if (u.pathname.endsWith("/page-1") ) return json({ error: { message: "no", code: 100 } }); // the token is already a Page token
    if (u.pathname.endsWith("/fbpost-1/comments")) {
      return json({ data: [
        { id: "c1", from: { id: "u1", name: "Ravi Kumar" }, message: "Do you have weekend batches?", created_time: "2026-11-05T10:00:00+0000" },
        { id: "c2", from: { id: "u2", name: "Spam Bot" }, message: "Earn $500 a day http://scam.example", created_time: "2026-11-05T11:00:00+0000" },
        { id: "c3", from: { id: "page-1", name: "Bright Tutors" }, message: "Our own reply", created_time: "2026-11-05T12:00:00+0000" },
      ] });
    }
    if (u.pathname.endsWith("/igmedia-1/comments")) {
      return json({ data: [
        { id: "i1", username: "sita_reads", text: "Loved this tip!", timestamp: "2026-11-05T10:00:00+0000" },
        { id: "i2", username: "brighttutors", text: "thanks", timestamp: "2026-11-05T10:05:00+0000" },
      ] });
    }
    res.writeHead(404).end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("community manager", () => {
  beforeEach(async () => {
    await freshDb();
    sent.length = 0;
    vi.stubEnv("META_GRAPH_URL", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  });
  afterEach(() => vi.unstubAllEnvs());

  async function setup() {
    const { ws } = await makeWorkspace("Community");
    const brand = await createBrand(ws.id, { name: "Bright Tutors", colors: [], platforms: ["facebook", "instagram"], website: "https://brighttutors.in" });
    const campaign = await createCampaign(ws.id, { brandId: brand.id, theme: "Weekend batches", platforms: ["facebook"], startDate: "2026-11-01", endDate: "2026-11-07", postsPerWeek: 2 });
    const fb = await saveChannel(ws.id, brand.id, "facebook", "Bright Tutors", "PAGE-TOKEN", { pageId: "page-1" });
    const ig = await saveChannel(ws.id, brand.id, "instagram", "@brighttutors", "IG-TOKEN", { igUserId: "ig-1" });
    const db = await getDb();
    const [post] = await db.insert(schema.posts).values({ workspaceId: ws.id, campaignId: campaign.id, brandId: brand.id, platform: "facebook", format: "image", publishOn: "2026-11-05", status: "published", caption: "Weekend batches are open", currentVersion: 1 }).returning();
    const now = new Date();
    await db.insert(schema.publications).values([
      { workspaceId: ws.id, postId: post.id, channelId: fb.id, platform: "facebook", version: 1, status: "sent", externalId: "fbpost-1", publishedAt: now },
      { workspaceId: ws.id, postId: post.id, channelId: ig.id, platform: "instagram", version: 1, status: "sent", externalId: "igmedia-1", publishedAt: now },
    ]);
    return { ws, brand };
  }

  it("reads new comments once, drafts replies, skips spam and our own replies", async () => {
    const { ws, brand } = await setup();
    const first = await runCommunity(ws.id, brand.id);
    expect(first).toEqual({ found: 3, drafted: 3 }); // c1, c2, i1 (not the Page's or our IG account's own)
    expect((await runCommunity(ws.id, brand.id)).found).toBe(0); // no duplicates

    const rows = await inbox(ws.id);
    const byId = Object.fromEntries(rows.map((r) => [r.c.externalId, r.c]));
    expect(byId.c1).toMatchObject({ intent: "question", status: "drafted", author: "Ravi Kumar" });
    expect(byId.c2).toMatchObject({ intent: "spam", status: "skipped", reply: null });
    expect(byId.i1).toMatchObject({ intent: "praise", status: "drafted" });
    expect(await inboxCount(ws.id)).toBe(2);
  });

  it("sends an edited reply to the right place on each platform", async () => {
    const { ws, brand } = await setup();
    await runCommunity(ws.id, brand.id);
    const rows = await inbox(ws.id, { status: "todo" });
    const fb = rows.find((r) => r.c.externalId === "c1")!.c;
    const ig = rows.find((r) => r.c.externalId === "i1")!.c;

    const done = await sendCommentReply(ws.id, fb.id, "Yes Ravi! Saturday and Sunday mornings.");
    expect(done.status).toBe("sent");
    expect(sent[0].path).toMatch(/\/c1\/comments$/);
    expect(decodeURIComponent(sent[0].body.replace(/\+/g, " "))).toContain("message=Yes Ravi! Saturday and Sunday mornings.");
    await sendCommentReply(ws.id, ig.id);
    expect(sent[1].path).toMatch(/\/i1\/replies$/);
    expect((await sendCommentReply(ws.id, fb.id)).status).toBe("sent"); // sending twice does nothing
    expect(sent).toHaveLength(2);

    await skipComment(ws.id, fb.id);
    expect(await inboxCount(ws.id)).toBe(0);
    const other = await makeWorkspace("Other");
    await expect(sendCommentReply(other.ws.id, ig.id)).rejects.toThrow(/not found/); // never across workspaces
  });

  it("asks for facts-only, short replies and schedules a read every 30 minutes", async () => {
    const p = replyPrompt({ name: "Bright Tutors", website: "https://brighttutors.in" }, { author: "Ravi", text: "Fees?", platform: "facebook" }, "Weekend batches");
    expect(p).toContain("TASK: COMMENT_REPLY");
    expect(p).toContain("only with facts from the brand key facts");
    expect(p).toContain("https://brighttutors.in");

    await setup();
    const now = new Date();
    expect(await queueDueCommunity(now)).toBe(1);
    expect(await queueDueCommunity(new Date(now.getTime() + 60_000))).toBe(0);
    expect(await queueDueCommunity(new Date(now.getTime() + 31 * 60_000))).toBe(1);
  });
});
