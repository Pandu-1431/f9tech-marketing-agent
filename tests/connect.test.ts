import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { createBrand } from "@/lib/data";
import { freshDb, makeWorkspace } from "./helpers";

// Signed-in owner, cookies and redirects stand-ins (server actions outside Next).
const auth = vi.hoisted(() => ({ current: null as null | { workspace: { id: number }; user: { id: number; name: string; email: string }; role: string } }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("@/lib/auth", () => ({ requireAuth: async () => auth.current, requireEditor: async () => auth.current, getAuth: async () => auth.current }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { value: jar.get(k)! } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
  }),
  headers: async () => new Headers(),
}));

const { findTelegramChats } = await import("@/agent/publish/telegram");
const { telegramConnectAction } = await import("@/app/actions/publishing");
const { listPages, metaAuthUrl, exchangeMetaCode, META_SCOPES } = await import("@/agent/publish/meta-connect");
const { metaPasteTokenAction, connectMetaPageAction } = await import("@/app/actions/meta");

const sent: { path: string; body: string }[] = [];
let server: http.Server;
let base = "";
beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const u = new URL(req.url!, "http://x");
      sent.push({ path: u.pathname, body });
      const json = (o: unknown, status = 200) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(o));
      // Telegram
      if (u.pathname.endsWith("/getMe")) return json({ ok: true, result: { username: "vizag_post_bot" } });
      if (u.pathname.endsWith("/getUpdates")) {
        return json({ ok: true, result: [
          { my_chat_member: { chat: { id: -1001, title: "Chakravyuh UPSC", username: "chakravyuh_upsc", type: "channel" }, new_chat_member: { status: "administrator", can_post_messages: true } } },
          { my_chat_member: { chat: { id: -1002, title: "Old channel", type: "channel" }, new_chat_member: { status: "administrator" } } },
          { my_chat_member: { chat: { id: -1002, title: "Old channel", type: "channel" }, new_chat_member: { status: "left" } } },
          { my_chat_member: { chat: { id: 55, first_name: "Ravi", type: "private" }, new_chat_member: { status: "member" } } },
        ] });
      }
      if (u.pathname.endsWith("/getChat")) return json({ ok: true, result: { username: "chakravyuh_upsc", title: "Chakravyuh UPSC" } });
      if (u.pathname.endsWith("/sendMessage")) return json({ ok: true, result: { message_id: 9, chat: { username: "chakravyuh_upsc" } } });
      // Meta Graph
      const token = u.searchParams.get("access_token");
      if (u.pathname.endsWith("/oauth/access_token")) {
        return json(u.searchParams.get("grant_type") === "fb_exchange_token" ? { access_token: "LONG-USER" } : { access_token: "SHORT-USER" });
      }
      if (u.pathname.endsWith("/me/accounts")) {
        if (token === "PAGE-TOKEN") return json({ error: { message: "(#100) Tried accessing nonexisting field (accounts)", code: 100 } }, 400);
        if (token === "LONELY-USER") return json({ data: [] });
        return json({ data: [
          { id: "p1", name: "Chakravyuh", access_token: "P1-TOKEN", picture: { data: { url: "https://pic" } }, instagram_business_account: { id: "ig1", username: "chakravyuh.app" } },
          { id: "p2", name: "Side Page", access_token: "P2-TOKEN" },
        ] });
      }
      if (u.pathname.endsWith("/me")) {
        if (token === "PAGE-TOKEN") return json({ id: "p9", name: "Solo Page", category: "Education" });
        return json({ error: { message: "(#100) Tried accessing nonexisting field (category)", code: 100 } }, 400);
      }
      json({ ok: false, description: "Not Found" }, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

async function owner() {
  const { ws, user } = await makeWorkspace("Connect");
  const brand = await createBrand(ws.id, { name: "Chakravyuh", colors: [], platforms: ["telegram", "facebook", "instagram"] });
  auth.current = { workspace: { id: ws.id }, user: { id: user.id, name: user.name, email: user.email }, role: "owner" };
  return { ws, brand };
}

describe("Telegram: one paste, pick the channel, real hello", () => {
  beforeEach(async () => {
    await freshDb();
    sent.length = 0;
    vi.stubEnv("TELEGRAM_API_URL", base);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("lists only the channels the bot is still an admin of", async () => {
    const r = await findTelegramChats("123456789:AAEabcdefghijklmnopqrstuvwxyz");
    expect(r.bot).toBe("vizag_post_bot");
    expect(r.chats).toEqual([{ id: "-1001", title: "Chakravyuh UPSC", username: "chakravyuh_upsc", canPost: true }]);
  });

  it("connects the picked channel and sends a real test message", async () => {
    const { ws, brand } = await owner();
    const token = "123456789:AAEabcdefghijklmnopqrstuvwxyz";
    expect((await telegramConnectAction(brand.id, undefined, form({ token: "nope" })))?.error).toMatch(/bot token/);
    const step1 = await telegramConnectAction(brand.id, undefined, form({ token }));
    expect(step1?.chats?.map((c) => c.username)).toEqual(["chakravyuh_upsc"]);
    const step2 = await telegramConnectAction(brand.id, undefined, form({ token, chatId: "@chakravyuh_upsc" }));
    expect(step2?.ok).toMatch(/Connected to @chakravyuh_upsc.*test message was sent/);
    const hello = sent.find((s) => s.path.endsWith("/sendMessage"))!;
    expect(JSON.parse(hello.body)).toMatchObject({ chat_id: "@chakravyuh_upsc", text: expect.stringContaining("Chakravyuh is connected") });
    const db = await getDb();
    const [ch] = await db.select().from(schema.channels).where(eq(schema.channels.workspaceId, ws.id));
    expect(ch).toMatchObject({ platform: "telegram", config: { chatId: "@chakravyuh_upsc" } });
  });
});

describe("Facebook + Instagram: log in, pick a Page", () => {
  beforeEach(async () => {
    await freshDb();
    jar.clear();
    vi.stubEnv("META_GRAPH_URL", base);
    vi.stubEnv("META_APP_ID", "app-1");
    vi.stubEnv("META_APP_SECRET", "secret-1");
    vi.stubEnv("SESSION_SECRET", "test-secret-test-secret-test-secret-123");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("asks Facebook for the posting, comment and results permissions and swaps the code for a long-lived token", async () => {
    const url = new URL(metaAuthUrl("http://localhost:3000/api/oauth/meta/callback", "st"));
    expect(url.searchParams.get("client_id")).toBe("app-1");
    expect(url.searchParams.get("scope")!.split(",")).toEqual(META_SCOPES);
    expect(META_SCOPES).toEqual(expect.arrayContaining(["pages_manage_posts", "instagram_content_publish", "instagram_manage_comments"]));
    expect(await exchangeMetaCode("code-1", "http://localhost:3000/api/oauth/meta/callback")).toBe("LONG-USER");
  });

  it("lists Pages for a user token, the Page itself for a Page token, nothing for a person with no Page", async () => {
    const pages = await listPages("LONG-USER");
    expect(pages.map((p) => [p.name, p.instagram?.username ?? null])).toEqual([["Chakravyuh", "chakravyuh.app"], ["Side Page", null]]);
    expect((await listPages("PAGE-TOKEN")).map((p) => p.name)).toEqual(["Solo Page"]);
    expect(await listPages("LONELY-USER")).toEqual([]);
  });

  it("connects the picked Page and its Instagram, then forgets the login token", async () => {
    const { ws, brand } = await owner();
    await expect(metaPasteTokenAction(brand.id, form({ token: "LONG-USER-xxxxxxxxxxxxxxxx" }))).rejects.toThrow(`REDIRECT /brands/${brand.id}/connect/meta`);
    expect(jar.has("ma_meta_pick")).toBe(true);
    expect(jar.get("ma_meta_pick")).not.toContain("LONG-USER"); // encrypted
    // The stand-in only knows "LONG-USER": paste that exact token.
    await metaPasteTokenAction(brand.id, form({ token: "LONG-USER" })).catch(() => null);
    await expect(connectMetaPageAction(brand.id, "p1", form({ instagram: "on" }))).rejects.toThrow(`REDIRECT /brands/${brand.id}?meta=connected-both#channels`);
    const db = await getDb();
    const chans = await db.select().from(schema.channels).where(eq(schema.channels.workspaceId, ws.id));
    expect(chans.map((c) => [c.platform, c.name, c.config]).sort()).toEqual([
      ["facebook", "Chakravyuh", { pageId: "p1" }],
      ["instagram", "@chakravyuh.app", { igUserId: "ig1", username: "chakravyuh.app" }],
    ]);
    expect(jar.has("ma_meta_pick")).toBe(false);
    await expect(connectMetaPageAction(brand.id, "p1", form({}))).rejects.toThrow(/meta=expired/); // the token is gone
  });
});
