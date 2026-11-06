import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { extractSite, onboardFromWebsite, pageColors, visibleText } from "@/agent/onboarding";
import { isPrivateAddress, normaliseUrl, safeFetch, UnsafeUrlError } from "@/lib/safe-fetch";
import { getFile } from "@/lib/storage";
import { freshDb, makeWorkspace } from "./helpers";

const HOME = `<!doctype html><html><head>
  <title>Green Leaf Cafe | Fresh coffee in Vizag</title>
  <meta name="description" content="Specialty coffee and fresh bakes on Beach Road.">
  <meta property="og:site_name" content="Green Leaf Cafe">
  <meta name="theme-color" content="#1b7f3a">
  <link rel="apple-touch-icon" href="/logo.png">
  <style>.btn{background:#1b7f3a;color:#fff}.hero{color:#f4a261}.x{color:#1b7f3a}</style>
  <script>var secret = "do not read me";</script>
</head><body>
  <nav><a href="/about">About us</a><a href="https://other.com/about">x</a></nav>
  <h1>Green Leaf Cafe</h1>
  <p>Specialty coffee roasted every morning in Visakhapatnam.</p>
  <p>Open 7 am to 10 pm, every day, on Beach Road.</p>
  <img src="/logo.png" alt="Green Leaf logo">
</body></html>`;
const ABOUT = `<html><body><h2>Our story</h2><p>Started in 2019 by two friends who love filter coffee.</p></body></html>`;

let server: http.Server;
let base = "";
beforeAll(async () => {
  const logo = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#1b7f3a" } }).png().toBuffer();
  server = http.createServer((req, res) => {
    if (req.url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(HOME);
    if (req.url === "/about") return res.writeHead(200, { "content-type": "text/html" }).end(ABOUT);
    if (req.url === "/logo.png") return res.writeHead(200, { "content-type": "image/png" }).end(logo);
    if (req.url === "/go") return res.writeHead(302, { location: "/" }).end();
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("reading a website", () => {
  it("extracts title, description, colours, logo candidates, about links and visible text only", () => {
    const s = extractSite(HOME, `${base}/`);
    expect(s.title).toBe("Green Leaf Cafe | Fresh coffee in Vizag");
    expect(s.siteName).toBe("Green Leaf Cafe");
    expect(s.description).toMatch(/Specialty coffee/);
    expect(s.themeColor).toBe("#1b7f3a");
    expect(s.colors[0]).toBe("#1b7f3a");
    expect(s.logoUrls[0]).toBe(`${base}/logo.png`);
    expect(s.links).toEqual([`${base}/about`]); // other sites' links are ignored
    expect(s.text).toMatch(/Open 7 am to 10 pm/);
    expect(s.text).not.toMatch(/do not read me|background/);
    expect(pageColors("#fff #000 #777777 #e63946")).toEqual(["#e63946"]);
    expect(visibleText("<p>a &amp; b</p><script>x</script>")).toBe("a & b");
  });

  it("blocks private and local addresses and non-web links", async () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.2.3.4")).toBe(true);
    expect(isPrivateAddress("192.168.1.9")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true); // cloud metadata
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateAddress("142.250.183.14")).toBe(false);
    expect(normaliseUrl("example.com").toString()).toBe("https://example.com/");
    expect(() => normaliseUrl("ftp://example.com")).toThrow(UnsafeUrlError);
    expect(() => normaliseUrl("https://user:pw@example.com")).toThrow(UnsafeUrlError);
    await expect(safeFetch(`${base}/`)).rejects.toThrow(/Private network|Local/);
    await expect(safeFetch("http://localhost:3000/")).rejects.toThrow(/Local addresses/);
  });
});

describe("setup from a website", () => {
  beforeEach(async () => {
    await freshDb();
    vi.stubEnv("SAFE_FETCH_ALLOW_PRIVATE", "true"); // the test site runs on this machine
  });
  afterEach(() => vi.unstubAllEnvs());

  it("creates a business with its Brand Kit, colours and logo from the site", async () => {
    const r = await safeFetch(`${base}/go`); // redirects are followed
    expect(r.url).toBe(`${base}/`);

    const { ws } = await makeWorkspace("Onboard");
    const brand = await onboardFromWebsite(ws.id, base);
    expect(brand.name).toBe("Green Leaf Cafe");
    expect(brand.website).toBe(`${base}/`);
    expect(brand.colors[0]).toBe("#1b7f3a");
    expect(brand.keyFacts).toMatch(/Specialty coffee roasted every morning/);
    expect(brand.hashtags[0]).toBe("#GreenLeafCafe");
    expect(brand.logoKey).toBeTruthy();
    const logo = await sharp((await getFile(brand.logoKey!))!).metadata();
    expect(logo.format).toBe("png");
  });

  it("explains when the address cannot be read", async () => {
    const { ws } = await makeWorkspace("Bad");
    await expect(onboardFromWebsite(ws.id, `${base}/missing`)).rejects.toThrow(/error 404/);
  });
});
