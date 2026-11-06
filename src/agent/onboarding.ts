import sharp from "sharp";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Brand } from "@/db/schema";
import { createBrand, setBrandLogo } from "@/lib/data";
import { newKey, putFile } from "@/lib/storage";
import { safeFetch } from "@/lib/safe-fetch";
import { PLATFORM_LABELS } from "@/lib/platforms";
import { parseJsonObject } from "./json";
import { generateText } from "./router";

/*
 * Setup from a link: read a business's website (home page + about/contact pages if linked),
 * let the AI fill the Brand Kit from what the site really says, and save the logo.
 * Works for any business: a shop, a school, an app's landing page, a Play Store page.
 */

export type SiteInfo = {
  url: string;
  title: string;
  description: string;
  siteName: string;
  themeColor: string | null;
  colors: string[];
  logoUrls: string[];
  text: string;
};

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

function meta(html: string, key: string): string {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]*>`, "i");
  const tag = re.exec(html)?.[0] ?? "";
  return decode(/content=["']([^"']*)["']/i.exec(tag)?.[1] ?? "").trim();
}

/** The readable words of a page: no scripts, styles, menus' markup or tags. */
export function visibleText(html: string): string {
  return decode(
    html
      .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|li|h[1-6]|section|article|br|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Brand colours a page uses most (hex codes in its inline CSS), most frequent first, greys left out. */
export function pageColors(html: string): string[] {
  const counts = new Map<string, number>();
  for (const m of html.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    let h = m[1].toLowerCase();
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    if (Math.max(r, g, b) - Math.min(r, g, b) < 40) continue; // grey, black, white
    counts.set(`#${h}`, (counts.get(`#${h}`) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 5);
}

export function extractSite(html: string, pageUrl: string): SiteInfo & { links: string[] } {
  const base = new URL(pageUrl);
  const abs = (href: string) => {
    try {
      return new URL(decode(href), base).toString();
    } catch {
      return null;
    }
  };
  const icons: { url: string; size: number }[] = [];
  for (const m of html.matchAll(/<link[^>]+>/gi)) {
    const tag = m[0];
    const rel = /rel=["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href || !/icon/.test(rel)) continue;
    const size = Number(/sizes=["'](\d+)x/i.exec(tag)?.[1] ?? (rel.includes("apple") ? 180 : 32));
    const u = abs(href);
    if (u) icons.push({ url: u, size });
  }
  // Images whose name or alt says "logo" are the best logo candidates.
  const logoImgs = [...html.matchAll(/<img[^>]+>/gi)]
    .map((m) => m[0])
    .filter((t) => /logo/i.test(t))
    .map((t) => abs(/src=["']([^"']+)["']/i.exec(t)?.[1] ?? ""))
    .filter((u): u is string => Boolean(u) && !u!.startsWith("data:"));
  const og = meta(html, "og:image");
  const logoUrls = [...new Set([...logoImgs, ...icons.sort((a, b) => b.size - a.size).filter((i) => i.size >= 64).map((i) => i.url), ...(og ? [abs(og)!] : [])])].filter(Boolean).slice(0, 4);
  const links = [...html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)]
    .map((m) => abs(m[1]))
    .filter((u): u is string => Boolean(u) && new URL(u!).host === base.host && /about|contact|story|who-we-are|features|services/i.test(u!))
    .filter((u, i, all) => all.indexOf(u) === i)
    .slice(0, 2);
  const theme = meta(html, "theme-color");
  return {
    url: pageUrl,
    title: decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").trim(),
    description: meta(html, "description") || meta(html, "og:description"),
    siteName: meta(html, "og:site_name") || meta(html, "application-name"),
    themeColor: /^#[0-9a-f]{6}$/i.test(theme) ? theme.toLowerCase() : null,
    colors: pageColors(html),
    logoUrls,
    text: visibleText(html),
    links,
  };
}

/** Home page + up to two about/contact pages. Text is capped so the prompt stays small. */
export async function readSite(url: string): Promise<SiteInfo> {
  const home = await safeFetch(url);
  if (home.status >= 400) throw new Error(`The website answered with error ${home.status}.`);
  if (!/html|xml|text/i.test(home.contentType)) throw new Error("That address is not a web page.");
  const info = extractSite(home.body.toString("utf8"), home.url);
  let text = info.text.slice(0, 7000);
  for (const link of info.links) {
    try {
      const page = await safeFetch(link, { maxBytes: 1_000_000 });
      if (page.status < 400) text += `\n\n[${new URL(page.url).pathname}]\n${visibleText(page.body.toString("utf8")).slice(0, 3000)}`;
    } catch {
      // an about page that fails is not a reason to stop
    }
  }
  return { ...info, text: text.slice(0, 12_000) };
}

export function brandFromSitePrompt(site: SiteInfo): string {
  return [
    "TASK: BRAND_FROM_SITE",
    `URL: ${site.url}`,
    `TITLE: ${site.title}`,
    `SITE NAME: ${site.siteName}`,
    `META DESCRIPTION: ${site.description}`,
    "PAGE TEXT:",
    site.text,
    "",
    "Fill a marketing Brand Kit for this business from the page text ONLY. Never invent numbers, prices, awards or claims.",
    "- name: the business or product name.",
    "- industry: 1-4 words (e.g. \"Sweet shop\", \"EdTech app\", \"Dental clinic\").",
    "- city: the city it serves, or \"\" if not stated (\"Online\" for apps and online services).",
    "- description: 2-3 plain sentences about what it offers.",
    "- audience: who it is for, one sentence.",
    "- tone: 3-4 words for the voice of its posts.",
    "- language: the main language of the site (e.g. \"English\").",
    "- services: what it sells or offers, max 8 short items.",
    "- key_facts: max 8 facts the site states (features, numbers, offers, hours, address). Each fact must be in the page text.",
    "- keywords: 6-10 search phrases its customers would type.",
    "- hashtags: 6-10 hashtags (with #).",
    "- dos / donts: one short line each for content rules that fit this business.",
    'Reply with JSON only: {"name":"","industry":"","city":"","description":"","audience":"","tone":"","language":"","services":[],"key_facts":[],"keywords":[],"hashtags":[],"dos":"","donts":""}',
  ].join("\n");
}

const kitSchema = z.object({
  name: z.string().default(""),
  industry: z.string().default(""),
  city: z.string().default(""),
  description: z.string().default(""),
  audience: z.string().default(""),
  tone: z.string().default(""),
  language: z.string().default("English"),
  services: z.array(z.string()).default([]),
  key_facts: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  hashtags: z.array(z.string()).default([]),
  dos: z.string().default(""),
  donts: z.string().default(""),
});

const clip = (s: string, n: number) => s.trim().slice(0, n);
const list = (a: string[], n: number, len: number) => a.map((s) => clip(String(s), len)).filter(Boolean).slice(0, n);

/** Download the best logo candidate as a PNG (skips tiny or broken images). */
async function fetchLogo(urls: string[]): Promise<Buffer | null> {
  for (const u of urls) {
    try {
      const r = await safeFetch(u, { maxBytes: 3_000_000, accept: "image/*" });
      if (r.status >= 400 || !/image/i.test(r.contentType) || /x-icon|vnd.microsoft.icon/i.test(r.contentType)) continue;
      const img = sharp(r.body);
      const m = await img.metadata();
      if ((m.width ?? 0) < 48 || (m.height ?? 0) < 48) continue;
      return await img.resize(600, 600, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    } catch {
      // try the next one
    }
  }
  return null;
}

/** Website link -> a new business account with its Brand Kit and logo filled in. */
export async function onboardFromWebsite(workspaceId: number, url: string, opts: { platforms?: string[] } = {}): Promise<Brand> {
  const site = await readSite(url);
  if (site.text.length < 80 && !site.description) throw new Error("The page has almost no text to read (it may need JavaScript). Fill the Brand Kit by hand instead.");
  const out = await generateText(
    { workspaceId, purpose: "brand_from_site" },
    { system: "You are a careful brand strategist. You only state what the source says.", prompt: brandFromSitePrompt(site), json: true, temperature: 0.2 },
  );
  const kit = kitSchema.parse(parseJsonObject(out.text));
  const colors = [...new Set([site.themeColor, ...site.colors].filter((c): c is string => Boolean(c)))].slice(0, 3);
  const platforms = (opts.platforms ?? ["instagram", "facebook"]).filter((p) => p in PLATFORM_LABELS);
  const brand = await createBrand(workspaceId, {
    name: clip(kit.name || site.siteName || site.title.split(/[|\-–]/)[0] || new URL(site.url).hostname, 160),
    industry: clip(kit.industry, 120) || null,
    website: clip(site.url, 300),
    city: clip(kit.city, 120) || null,
    description: clip(kit.description || site.description, 1000) || null,
    audience: clip(kit.audience, 500) || null,
    tone: clip(kit.tone, 200) || null,
    language: clip(kit.language, 60) || "English",
    colors: colors.length ? colors : ["#3730a3", "#f59e0b"],
    keywords: list(kit.keywords, 10, 80),
    hashtags: list(kit.hashtags, 10, 40).map((h) => (h.startsWith("#") ? h : `#${h}`).replace(/\s+/g, "")),
    services: list(kit.services, 8, 120).join("\n") || null,
    keyFacts: list(kit.key_facts, 8, 200).join("\n") || null,
    dos: clip(kit.dos, 500) || null,
    donts: clip(kit.donts, 500) || null,
    platforms: platforms.length ? platforms : ["instagram"],
  });
  const logo = await fetchLogo(site.logoUrls);
  if (logo) {
    const key = newKey(workspaceId, "logo", "image/png");
    await putFile(key, logo, "image/png");
    const db = await getDb();
    await db.insert(schema.assets).values({ workspaceId, brandId: brand.id, kind: "logo", storageKey: key, mime: "image/png", bytes: logo.length, provider: "website" });
    await setBrandLogo(workspaceId, brand.id, key);
    return { ...brand, logoKey: key };
  }
  return brand;
}
