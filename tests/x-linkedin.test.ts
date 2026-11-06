import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { oauthHeader, parseXKeys, publishX, testX, xText } from "@/agent/publish/x";
import { linkedinVersion, littleText, publishLinkedIn, testLinkedIn } from "@/agent/publish/linkedin";
import { PublishConfigError } from "@/agent/publish/types";

const seen: { method: string; path: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
let server: http.Server;
let base = "";
beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("latin1");
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const path = new URL(req.url!, "http://x").pathname;
      seen.push({ method: req.method!, path, headers: req.headers, body });
      const json = (o: unknown, status = 200, headers: Record<string, string> = {}) => res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(o));
      if (path === "/2/users/me") return req.headers.authorization?.includes("bad") ? json({ detail: "Unauthorized" }, 401) : json({ data: { username: "brighttutors" } });
      if (path === "/1.1/media/upload.json") return json({ media_id_string: "m-77" });
      if (path === "/2/tweets") return json({ data: { id: "t-1" } }, 201);
      if (path === "/v2/userinfo") return json({ sub: "abc123", name: "Ravi Kumar" });
      if (path === "/rest/images") return json({ value: { uploadUrl: `${base}/upload/img-1`, image: "urn:li:image:img-1" } });
      if (path === "/upload/img-1") return res.writeHead(201).end();
      if (path === "/rest/posts") return json({}, 201, { "x-restli-id": "urn:li:share:999" });
      json({}, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const KEYS = JSON.stringify({ apiKey: "k", apiSecret: "s", accessToken: "t", accessSecret: "ts" });
const png = { data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), mime: "image/png" };

describe("X (Twitter)", () => {
  beforeEach(() => {
    seen.length = 0;
    vi.stubEnv("X_API_URL", base);
    vi.stubEnv("X_UPLOAD_URL", base);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("signs requests exactly like X's documented example", () => {
    const keys = {
      apiKey: "xvz1evFS4wEEPTGEFPHBog",
      apiSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
      accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
      accessSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
    };
    const url = "https://api.twitter.com/1.1/statuses/update.json?include_entities=true&status=" + encodeURIComponent("Hello Ladies + Gentlemen, a signed OAuth request!");
    const h = oauthHeader("POST", url, keys, { nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", timestamp: "1318622958" });
    expect(h).toContain(`oauth_signature="${encodeURIComponent("hCtSmYh+iHYCEqBWrE7C7hYmtUk=")}"`);
    expect(() => parseXKeys('{"apiKey":"k"}')).toThrow(PublishConfigError);
  });

  it("fits a long caption into 280 characters, keeping the link and two hashtags", () => {
    const caption = `${"Prepare smart for your board exams with a daily plan that really works. ".repeat(6)}\n\n#Exams #Study #Class10 #Tips`;
    const out = xText(caption, "https://brighttutors.in/a/very/long/path?utm_source=x&utm_medium=social");
    const counted = out.replace(/https?:\/\/\S+/g, "x".repeat(23));
    expect(counted.length).toBeLessThanOrEqual(280);
    expect(out).toContain("https://brighttutors.in/a/very/long/path");
    expect(out).toMatch(/#Exams #Study$/);
    expect(out).toContain("…");
    expect(xText("Short and sweet #a")).toBe("Short and sweet\n\n#a");
  });

  it("tests the keys and posts text with the poster", async () => {
    expect(await testX({ token: KEYS, config: {} })).toBe("@brighttutors");
    const r = await publishX({ token: KEYS, config: { username: "brighttutors" } }, { text: "Hello #Tips", image: png, link: "https://b.in" });
    expect(r).toEqual({ externalId: "t-1", url: "https://x.com/brighttutors/status/t-1" });
    const tweet = seen.find((s) => s.path === "/2/tweets")!;
    expect(JSON.parse(tweet.body)).toEqual({ text: "Hello\n\nhttps://b.in\n#Tips", media: { media_ids: ["m-77"] } });
    expect(tweet.headers.authorization).toMatch(/^OAuth oauth_consumer_key="k"/);
    await expect(testX({ token: JSON.stringify({ apiKey: "bad", apiSecret: "s", accessToken: "t", accessSecret: "ts" }), config: {} })).rejects.toThrow(PublishConfigError);
  });
});

describe("LinkedIn", () => {
  beforeEach(() => {
    seen.length = 0;
    vi.stubEnv("LINKEDIN_API_URL", base);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uses a supported API version and escapes LinkedIn's markup characters", () => {
    expect(linkedinVersion(new Date("2026-11-06T00:00:00Z"))).toBe("202609");
    expect(linkedinVersion(new Date("2026-01-15T00:00:00Z"))).toBe("202511");
    expect(littleText("Join us (free) #Exams @school")).toBe("Join us \\(free\\) \\#Exams \\@school");
  });

  it("posts to the profile with an uploaded image and returns the post link", async () => {
    expect(await testLinkedIn({ token: "tok", config: {} })).toBe("Ravi Kumar");
    const r = await publishLinkedIn({ token: "tok", config: {} }, { text: "Free class (Saturday) #Maths", image: png, link: "https://b.in" });
    expect(r).toEqual({ externalId: "urn:li:share:999", url: "https://www.linkedin.com/feed/update/urn:li:share:999" });
    const post = seen.find((s) => s.path === "/rest/posts")!;
    const body = JSON.parse(post.body);
    expect(body.author).toBe("urn:li:person:abc123");
    expect(body.commentary).toBe("Free class \\(Saturday\\) \\#Maths\n\nhttps://b.in");
    expect(body.content).toEqual({ media: { id: "urn:li:image:img-1" } });
    expect(post.headers["linkedin-version"]).toMatch(/^\d{6}$/);
    expect(seen.some((s) => s.method === "PUT" && s.path === "/upload/img-1")).toBe(true);
  });
});
