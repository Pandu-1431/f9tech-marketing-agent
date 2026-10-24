import sharp, { type OverlayOptions } from "sharp";
import { escapeXml, readableOn, wrap } from "../images/poster";

export const REEL_W = 1080;
export const REEL_H = 1920;
const FONT = "Poppins, Inter, 'Helvetica Neue', Helvetica, Arial, 'DejaVu Sans', sans-serif";

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

  const headSize = 86;
  const headLines = f.onScreen ? wrap(f.onScreen, 18, 3) : [];
  const headTop = 360;
  const subSize = 46;
  const subLines = f.cta ? [] : wrap(f.subtitle, 34, 4);
  const subBoxH = subLines.length * 62 + 56;
  const subTop = 1460 - subBoxH / 2;

  const ctaText = f.cta ? escapeXml(f.cta.toUpperCase()) : "";
  const ctaW = Math.round(ctaText.length * 30 + 120);

  const seg = (W - 120 - (f.sceneCount - 1) * 12) / f.sceneCount;
  const bars = Array.from({ length: f.sceneCount }, (_, i) =>
    `<rect x="${60 + i * (seg + 12)}" y="40" width="${seg}" height="8" rx="4" fill="#ffffff" fill-opacity="${i <= f.sceneIndex ? 0.95 : 0.35}"/>`,
  ).join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.7"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
      <linearGradient id="bot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.65"/></linearGradient>
    </defs>
    <rect x="0" y="0" width="${W}" height="${headTop + headLines.length * 100 + 160}" fill="url(#top)"/>
    <rect x="0" y="${H - 760}" width="${W}" height="760" fill="url(#bot)"/>
    ${bars}
    ${headLines
      .map(
        (l, i) =>
          `<text x="${W / 2}" y="${headTop + headSize + i * 100}" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="${headSize}" fill="#ffffff" stroke="#000" stroke-opacity="0.25" stroke-width="2">${escapeXml(l)}</text>`,
      )
      .join("")}
    ${
      subLines.length
        ? `<rect x="80" y="${subTop}" width="${W - 160}" height="${subBoxH}" rx="28" fill="#000" fill-opacity="0.62"/>
           ${subLines.map((l, i) => `<text x="${W / 2}" y="${subTop + 28 + subSize + i * 62}" text-anchor="middle" font-family="${FONT}" font-weight="600" font-size="${subSize}" fill="#ffffff">${escapeXml(l)}</text>`).join("")}`
        : ""
    }
    ${
      f.cta
        ? `<rect x="${(W - ctaW) / 2}" y="1380" width="${ctaW}" height="120" rx="60" fill="${accent}"/>
           <text x="${W / 2}" y="1458" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="50" fill="${readableOn(accent)}">${ctaText}</text>`
        : ""
    }
    <rect x="0" y="${H - 110}" width="${W}" height="110" fill="${primary}" fill-opacity="0.92"/>
    <text x="${W / 2}" y="${H - 42}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="38" fill="${readableOn(primary)}">${escapeXml(f.brandName)}</text>
  </svg>`;

  const layers: OverlayOptions[] = [];
  const chip = 170;
  if (f.logo) {
    const logo = await sharp(f.logo).resize(chip - 36, chip - 36, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
    layers.push({
      input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${chip}" height="${chip}"><rect width="${chip}" height="${chip}" rx="34" fill="#fff" fill-opacity="0.95"/></svg>`),
      left: 60,
      top: 90,
    });
    layers.push({ input: logo, left: 78, top: 108 });
  }
  const overlay = await sharp(Buffer.from(svg)).composite(layers).png().toBuffer();
  return { background: bg, overlay };
}
