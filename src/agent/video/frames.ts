import sharp, { type OverlayOptions } from "sharp";
import { escapeXml, readableOn, wrap } from "../images/poster";
import { casedFor, DEFAULT_BODY_FONT, DEFAULT_HEADING_FONT, ensureFonts, fontStack, widthFactor } from "@/lib/fonts";
import { creativeSpec } from "@/lib/formats";

ensureFonts();

export const REEL_W = 1080;
export const REEL_H = 1920;

type FrameInput = {
  background: Buffer;
  onScreen: string;
  subtitle: string;
  brandName: string;
  colors: string[];
  logo?: Buffer | null;
  /** Last scene: show a call-to-action button instead of a subtitle box. */
  cta?: string | null;
  sceneIndex: number;
  sceneCount: number;
  /** Brand heading and body fonts. */
  fonts?: { heading: string; body: string };
  /** text = huge centred words; presenter = name tag; concept = step chip above the headline. */
  layout?: "standard" | "text" | "presenter" | "concept";
  /** Concept: the step label ("The idea"). Presenter: the presenter's name. */
  label?: string | null;
  /** Animated captions are drawn separately (captionFrame): leave out the static subtitle box. */
  liveCaptions?: boolean;
};

/** Where animated captions sit: the lower middle, above the platform's caption area. */
export const CAPTION_Y = 1230;

/**
 * Split a voiceover line into short caption chunks (about 3 words) timed to the voice:
 * longer chunks stay on screen longer. Times are seconds from the start of the scene.
 */
export function captionChunks(text: string, voiceSec: number, maxChars = 18): { text: string; start: number; end: number }[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const chunks: string[] = [];
  let cur: string[] = [];
  for (const w of words) {
    const next = [...cur, w].join(" ");
    if (cur.length && (next.length > maxChars || cur.length >= 3)) {
      chunks.push(cur.join(" "));
      cur = [w];
    } else cur.push(w);
  }
  if (cur.length) chunks.push(cur.join(" "));
  if (!chunks.length) return [];
  const lead = 0.1;
  const span = Math.max(0.6 * chunks.length, voiceSec - lead);
  const weights = chunks.map((c) => c.length + 4);
  const total = weights.reduce((a, b) => a + b, 0);
  let t = lead;
  return chunks.map((c, i) => {
    const d = (span * weights[i]) / total;
    const out = { text: c, start: Number(t.toFixed(3)), end: Number((t + d).toFixed(3)) };
    t += d;
    return out;
  });
}

/** One caption chunk as a transparent full-frame PNG: big bold words, the longest word in the accent colour. */
export async function captionFrame(text: string, colors: string[], fonts?: { heading: string; body: string }): Promise<Buffer> {
  const palette = colors.filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  const accent = palette[1] ?? palette[0] ?? "#F59E0B";
  const family = fonts?.heading ?? DEFAULT_HEADING_FONT;
  const FONT = fontStack(family, text);
  const size = 78;
  const lines = wrap(text, 14, 2);
  const longest = text.split(" ").reduce((a, b) => (b.replace(/[^\p{L}\p{N}]/gu, "").length > a.replace(/[^\p{L}\p{N}]/gu, "").length ? b : a), "");
  let marked = false;
  const line = (l: string) =>
    l
      .split(" ")
      .map((w) => {
        const hit = !marked && w === longest;
        if (hit) marked = true;
        return hit ? `<tspan fill="${accent}">${escapeXml(w)}</tspan>` : escapeXml(w);
      })
      .join(" ");
  const top = CAPTION_Y - ((lines.length - 1) * 96) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${REEL_W}" height="${REEL_H}">
    ${lines
      .map(
        (l, i) =>
          `<text x="${REEL_W / 2}" y="${top + i * 96}" text-anchor="middle" font-family="${FONT}" font-weight="900" font-size="${size}" fill="#ffffff" stroke="#000000" stroke-width="12" stroke-linejoin="round" paint-order="stroke">${line(l)}</text>`,
      )
      .join("")}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const hex = (c: string) => /^#[0-9a-f]{6}$/i.test(c);

function shade(color: string, amount: number): string {
  const n = parseInt(color.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v + 255 * amount)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Text videos: a brand-colour gradient with soft shapes (no AI image needed). Each scene shifts the colours. */
export async function textBackground(colors: string[], sceneIndex: number): Promise<Buffer> {
  const palette = colors.filter(hex);
  const base = palette.length ? palette : ["#4F46E5", "#F59E0B"];
  const a = base[sceneIndex % base.length];
  const b = shade(base[(sceneIndex + 1) % base.length], -0.25);
  const angle = [[0, 0, 1, 1], [1, 0, 0, 1], [0, 1, 1, 0]][sceneIndex % 3];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${REEL_W}" height="${REEL_H}">
    <defs>
      <linearGradient id="g" x1="${angle[0]}" y1="${angle[1]}" x2="${angle[2]}" y2="${angle[3]}"><stop offset="0" stop-color="${shade(a, -0.1)}"/><stop offset="1" stop-color="${b}"/></linearGradient>
      <radialGradient id="r" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${180 + (sceneIndex * 260) % 700}" cy="420" r="420" fill="url(#r)"/>
    <circle cx="${900 - (sceneIndex * 190) % 600}" cy="1500" r="560" fill="url(#r)"/>
    <rect x="-200" y="${700 + (sceneIndex % 3) * 120}" width="1600" height="90" fill="#fff" fill-opacity="0.05" transform="rotate(-12 540 960)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * One scene = a background (zoomed slowly by ffmpeg) + a transparent overlay that stays still:
 * big on-screen text, subtitle (or CTA button), logo, progress bar, brand bar.
 */
export async function renderSceneFrame(f: FrameInput): Promise<{ background: Buffer; overlay: Buffer }> {
  const W = REEL_W;
  const H = REEL_H;
  const palette = f.colors.filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  const primary = palette[0] ?? "#4F46E5";
  const accent = palette[1] ?? "#F59E0B";

  const bg = await sharp(f.background).resize(W, H, { fit: "cover", position: "attention" }).toBuffer();

  // Instagram/Facebook Reels and YouTube Shorts cover the top bar, the right-hand buttons and the
  // bottom caption area: all text stays inside the safe zone.
  const safe = creativeSpec("instagram", "reel").safe;
  const left = safe.left;
  const boxW = W - safe.left - safe.right;
  const cx = left + boxW / 2;
  const headFamily = f.fonts?.heading ?? DEFAULT_HEADING_FONT;
  const bodyFamily = f.fonts?.body ?? DEFAULT_BODY_FONT;
  const onScreen = casedFor(headFamily, f.onScreen);
  const HEAD = fontStack(headFamily, onScreen);
  const BODY = fontStack(bodyFamily, `${f.subtitle} ${f.cta ?? ""} ${f.brandName}`);

  const layout = f.layout ?? "standard";
  const isText = layout === "text";
  const headSize = isText ? 124 : 84;
  const lineH = isText ? 140 : 100;
  const headLines = onScreen ? wrap(onScreen, Math.floor(boxW / (headSize * widthFactor(headFamily))), isText ? 4 : 3) : [];
  // Text videos: words in the middle of the screen. Others: below the logo row (concept leaves room for the step chip).
  const headTop = isText ? Math.round(H / 2 - (headLines.length * lineH) / 2 - headSize) : safe.top + (layout === "concept" ? 290 : 210);
  const subSize = 44;
  const subLines = f.cta || f.liveCaptions ? [] : wrap(f.subtitle, Math.floor((boxW - 60) / (subSize * 0.55)), isText ? 3 : 4);
  const subBoxH = subLines.length * 60 + 52;
  const subBottom = H - safe.bottom - 40;
  const subTop = subBottom - subBoxH;

  const ctaText = f.cta ? escapeXml(f.cta.toUpperCase()) : "";
  const ctaW = Math.min(boxW, Math.round(ctaText.length * 30 + 120));
  const ctaTop = H - safe.bottom - 200;

  const seg = (W - 120 - (f.sceneCount - 1) * 12) / f.sceneCount;
  const bars = Array.from({ length: f.sceneCount }, (_, i) =>
    `<rect x="${60 + i * (seg + 12)}" y="40" width="${seg}" height="8" rx="4" fill="#ffffff" fill-opacity="${i <= f.sceneIndex ? 0.95 : 0.35}"/>`,
  ).join("");

  const chip = 140;
  const chipTop = safe.top + 20;
  const nameX = f.logo ? left + chip + 24 : left;

  const label = f.label ? escapeXml(f.label.toUpperCase()) : "";
  const chipW = Math.round(label.length * 24 + 80);
  const stepChip =
    layout === "concept" && label
      ? `<rect x="${cx - chipW / 2}" y="${safe.top + 200}" width="${chipW}" height="72" rx="36" fill="${accent}"/>
         <text x="${cx}" y="${safe.top + 248}" text-anchor="middle" font-family="${BODY}" font-weight="800" font-size="36" letter-spacing="2" fill="${readableOn(accent)}">${f.sceneIndex + 1} · ${label}</text>`
      : "";
  const tagW = Math.round((f.label?.length ?? 0) * 26 + f.brandName.length * 18 + 110);
  const nameTag =
    layout === "presenter" && label && !f.cta
      ? `<g transform="translate(${left} ${f.liveCaptions ? CAPTION_Y + 140 : subTop - 120})">
           <rect width="${Math.min(boxW, tagW)}" height="84" rx="18" fill="#fff" fill-opacity="0.95"/>
           <rect width="12" height="84" rx="6" fill="${accent}"/>
           <text x="32" y="55" font-family="${BODY}" font-weight="800" font-size="40" fill="#111">${escapeXml(f.label ?? "")}<tspan font-weight="500" font-size="32" fill="#555"> · ${escapeXml(f.brandName.split(" · ")[0])}</tspan></text>
         </g>`
      : "";
  const textUnderline = isText && headLines.length
    ? `<rect x="${cx - 110}" y="${headTop + headSize + (headLines.length - 1) * lineH + 40}" width="220" height="14" rx="7" fill="${accent}"/>`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.7"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
      <linearGradient id="bot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.7"/></linearGradient>
    </defs>
    ${isText ? "" : `<rect x="0" y="0" width="${W}" height="${headTop + headLines.length * 100 + 200}" fill="url(#top)"/>`}
    <rect x="0" y="${H - 900}" width="${W}" height="900" fill="url(#bot)"/>
    ${bars}
    <rect x="${nameX}" y="${chipTop + chip / 2 - 34}" width="8" height="68" rx="4" fill="${accent}"/>
    <text x="${nameX + 24}" y="${chipTop + chip / 2 + 14}" font-family="${BODY}" font-weight="700" font-size="40" fill="#ffffff">${escapeXml(f.brandName)}</text>
    ${headLines
      .map(
        (l, i) =>
          `<text x="${cx}" y="${headTop + headSize + i * lineH}" text-anchor="middle" font-family="${HEAD}" font-weight="800" font-size="${headSize}" fill="#ffffff" stroke="#000" stroke-opacity="0.25" stroke-width="2">${escapeXml(l)}</text>`,
      )
      .join("")}
    ${textUnderline}
    ${stepChip}
    ${nameTag}
    ${
      subLines.length
        ? `<rect x="${left}" y="${subTop}" width="${boxW}" height="${subBoxH}" rx="28" fill="#000" fill-opacity="0.62"/>
           ${subLines.map((l, i) => `<text x="${cx}" y="${subTop + 26 + subSize + i * 60}" text-anchor="middle" font-family="${BODY}" font-weight="600" font-size="${subSize}" fill="#ffffff">${escapeXml(l)}</text>`).join("")}`
        : ""
    }
    ${
      f.cta
        ? `<rect x="${cx - ctaW / 2}" y="${ctaTop}" width="${ctaW}" height="120" rx="60" fill="${accent}"/>
           <text x="${cx}" y="${ctaTop + 78}" text-anchor="middle" font-family="${BODY}" font-weight="800" font-size="50" fill="${readableOn(accent)}">${ctaText}</text>`
        : ""
    }
    <rect x="0" y="${H - 14}" width="${W}" height="14" fill="${primary}"/>
  </svg>`;

  const layers: OverlayOptions[] = [];
  if (f.logo) {
    const logo = await sharp(f.logo).resize(chip - 36, chip - 36, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
    layers.push({
      input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${chip}" height="${chip}"><rect width="${chip}" height="${chip}" rx="34" fill="#fff" fill-opacity="0.95"/></svg>`),
      left,
      top: chipTop,
    });
    layers.push({ input: logo, left: left + 18, top: chipTop + 18 });
  }
  const overlay = await sharp(Buffer.from(svg)).composite(layers).png().toBuffer();
  return { background: bg, overlay };
}
