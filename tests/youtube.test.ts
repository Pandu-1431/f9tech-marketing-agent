import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exchangeGoogleCode, googleAuthUrl, myChannel, publishYouTube, shortsText, testYouTube } from "@/agent/publish/youtube";
import { PublishConfigError } from "@/agent/publish/types";
import { checkOAuthState, googleRedirectUri, newOAuthState } from "@/lib/oauth";

type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown };
let calls: Call[] = [];

function stubGoogle(over: (c: Call) => Response | undefined = () => undefined) {
  calls = [];
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    const c: Call = { url: String(input), method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers).entries()), body: init.body };
    calls.push(c);
    const o = over(c);
    if (o) return o;
    const json = (x: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(x), { status: 200, ...init });
    if (c.url.includes("oauth2.googleapis.com/token")) {
      const p = new URLSearchParams(String(c.body));
      return p.get("grant_type") === "authorization_code" ? json({ access_token: "AT1", refresh_token: "RT1" }) : json({ access_token: "AT2" });
    }
    if (c.url.includes("/youtube/v3/channels")) return json({ items: [{ id: "UC123", snippet: { title: "Chakravyuh" } }] });
    if (c.url.includes("uploadType=resumable")) return new Response(null, { status: 200, headers: { location: "https://upload.example/session1" } });
    if (c.url === "https://upload.example/session1") return json({ id: "vid42", status: { privacyStatus: "private" } });
    return json({});
  });
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "cid.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("YouTube sign-in", () => {
  it("asks Google for offline access to upload, with our state and callback", () => {
    const u = new URL(googleAuthUrl("http://localhost:3000/api/oauth/google/callback", "STATE"));
    expect(u.searchParams.get("scope")).toContain("youtube.upload");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("state")).toBe("STATE");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/oauth/google/callback");
  });

  it("checks the state round trip and builds the callback address", () => {
    const { state, cookie } = newOAuthState(166);
    expect(checkOAuthState(cookie, state)).toBe(166);
    expect(checkOAuthState(cookie, "forged-state-forged-state-forged-")).toBeNull();
    expect(checkOAuthState(undefined, state)).toBeNull();
    expect(googleRedirectUri("http://localhost:3000/api/oauth/google/start?brandId=1")).toBe("http://localhost:3000/api/oauth/google/callback");
    vi.stubEnv("APP_URL", "https://agent.f9tech.com/");
    expect(googleRedirectUri("http://internal:3000/x")).toBe("https://agent.f9tech.com/api/oauth/google/callback");
  });

  it("exchanges the code for a refresh token and finds the channel", async () => {
    stubGoogle();
    const t = await exchangeGoogleCode("CODE", "http://localhost:3000/api/oauth/google/callback");
    expect(t).toEqual({ refreshToken: "RT1", accessToken: "AT1" });
    expect(await myChannel(t.accessToken)).toEqual({ id: "UC123", title: "Chakravyuh" });
    expect(await testYouTube({ token: "RT1", config: {} })).toBe("Chakravyuh");
  });

  it("a revoked sign-in is a config error (connect again), not retried", async () => {
    stubGoogle((c) => (c.url.includes("/token") ? new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }) : undefined));
    await expect(testYouTube({ token: "old", config: {} })).rejects.toBeInstanceOf(PublishConfigError);
  });

  it("an account without a channel says so", async () => {
    stubGoogle((c) => (c.url.includes("/channels") ? new Response(JSON.stringify({ items: [] }), { status: 200 }) : undefined));
    await expect(myChannel("AT")).rejects.toThrow(/no YouTube channel/);
  });
});

describe("YouTube Shorts upload", () => {
  it("uploads the reel with a #Shorts title and returns the Shorts link", async () => {
    stubGoogle();
    const mp4 = Buffer.from("fake-mp4");
    const r = await publishYouTube({ token: "RT1", config: { channelId: "UC123" } }, { text: "Only 199 days to Prelims. Start today.\n\n#UPSC #Prelims", video: { data: mp4, mime: "video/mp4" } });
    expect(r).toEqual({ externalId: "vid42", url: "https://youtube.com/shorts/vid42" });
    const start = calls.find((c) => c.url.includes("uploadType=resumable"))!;
    expect(start.headers.authorization).toBe("Bearer AT2");
    const meta = JSON.parse(String(start.body));
    expect(meta.snippet.title).toBe("Only 199 days to Prelims. Start today. #Shorts");
    expect(meta.snippet.categoryId).toBe("27");
    expect(meta.status.privacyStatus).toBe("public");
    expect(calls.find((c) => c.url === "https://upload.example/session1")?.method).toBe("PUT");
  });

  it("needs a video", async () => {
    await expect(publishYouTube({ token: "RT1", config: {} }, { text: "x" })).rejects.toBeInstanceOf(PublishConfigError);
  });

  it("keeps titles within YouTube's 100 characters", () => {
    const { title } = shortsText(`#UPSC\n${"word ".repeat(40)}`);
    expect(title.length).toBeLessThanOrEqual(100);
    expect(title.endsWith("#Shorts")).toBe(true);
  });
});
