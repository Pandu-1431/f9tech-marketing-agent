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
};

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

  const headSize = 84;
  const headLines = onScreen ? wrap(onScreen, Math.floor(boxW / (headSize * widthFactor(headFamily))), 3) : [];
  const headTop = safe.top + 210; // below the logo row
  const subSize = 44;
  const subLines = f.cta ? [] : wrap(f.subtitle, Math.floor((boxW - 60) / (subSize * 0.55)), 4);
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

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.7"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
      <linearGradient id="bot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.7"/></linearGradient>
    </defs>
    <rect x="0" y="0" width="${W}" height="${headTop + headLines.length * 100 + 200}" fill="url(#top)"/>
    <rect x="0" y="${H - 900}" width="${W}" height="900" fill="url(#bot)"/>
    ${bars}
    <rect x="${nameX}" y="${chipTop + chip / 2 - 34}" width="8" height="68" rx="4" fill="${accent}"/>
    <text x="${nameX + 24}" y="${chipTop + chip / 2 + 14}" font-family="${BODY}" font-weight="700" font-size="40" fill="#ffffff">${escapeXml(f.brandName)}</text>
    ${headLines
      .map(
        (l, i) =>
          `<text x="${cx}" y="${headTop + headSize + i * 100}" text-anchor="middle" font-family="${HEAD}" font-weight="800" font-size="${headSize}" fill="#ffffff" stroke="#000" stroke-opacity="0.25" stroke-width="2">${escapeXml(l)}</text>`,
      )
      .join("")}
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
