import sharp from "sharp";
import { luminance, mix, readableOn } from "../images/poster";
import { measure, svgText } from "../images/measure";
import { DEFAULT_BODY_FONT, DEFAULT_HEADING_FONT, ensureFonts } from "@/lib/fonts";
import { REEL_H, REEL_W } from "./frames";

ensureFonts();

/*
 * Reel scenes that need no AI image (free, and always on-brand):
 * - productShot: a screenshot of the brand's app or website inside a phone, on the brand colours.
 * - endCard: the last 2-3 seconds: logo, brand name, call to action and website.
 */

const hex = (c: string | undefined, fallback: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : fallback);

function brandBackground(colors: string[]): string {
  const primary = hex(colors[0], "#4F46E5");
  const accent = hex(colors[1], "#F59E0B");
  const dark = mix(primary, "#000000", 0.45);
  return `<defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${primary}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>
    <rect width="${REEL_W}" height="${REEL_H}" fill="url(#g)"/>
    <circle cx="${REEL_W - 80}" cy="320" r="300" fill="${accent}" fill-opacity="0.16"/>
    <circle cx="120" cy="${REEL_H - 260}" r="260" fill="#ffffff" fill-opacity="0.06"/>`;
}

/** A screenshot in a phone frame on the brand background (used as a scene background). */
export async function productShotBackground(shot: Buffer, colors: string[]): Promise<Buffer> {
  const phoneW = 520;
  const meta = await sharp(shot).metadata();
  const ratio = meta.width && meta.height ? meta.height / meta.width : 2.1;
  const screenW = phoneW - 36;
  const screenH = Math.min(1080, Math.round(screenW * Math.min(Math.max(ratio, 1.6), 2.3)));
  const phoneH = screenH + 36;
  const x = Math.round((REEL_W - phoneW) / 2);
  const y = 730;
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${screenW}" height="${screenH}"><rect width="${screenW}" height="${screenH}" rx="40" fill="#fff"/></svg>`);
  const screen = await sharp(shot).resize(screenW, screenH, { fit: "cover", position: "top" }).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  const base = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${REEL_W}" height="${REEL_H}">${brandBackground(colors)}
    <rect x="${x + 14}" y="${y + 24}" width="${phoneW}" height="${phoneH}" rx="58" fill="#000" fill-opacity="0.35"/>
    <rect x="${x}" y="${y}" width="${phoneW}" height="${phoneH}" rx="58" fill="#111318"/>
  </svg>`);
  return sharp(base).composite([{ input: screen, left: x + 18, top: y + 18 }]).png().toBuffer();
}

/** The closing card: logo, name, CTA button, website. Returns a full 1080x1920 frame. */
export async function endCardFrame(input: {
  brandName: string;
  colors: string[];
  logo?: Buffer | null;
  cta?: string | null;
  website?: string | null;
  fonts?: { heading: string; body: string };
}): Promise<Buffer> {
  const heading = input.fonts?.heading ?? DEFAULT_HEADING_FONT;
  const body = input.fonts?.body ?? DEFAULT_BODY_FONT;
  const primary = hex(input.colors[0], "#4F46E5");
  const accent = hex(input.colors[1], "#F59E0B");
  const onBg = luminance(primary) > 0.6 ? "#111111" : "#ffffff";
  const cx = REEL_W / 2;
  const logoSize = 300;
  const logoTop = 560;
  const nameY = logoTop + logoSize + 130;
  const cta = (input.cta ?? "").toUpperCase();
  const ctaSize = 50;
  const ctaW = cta ? Math.min(REEL_W - 160, Math.round(measure(cta, { family: body, weight: 800, size: ctaSize }) + 140)) : 0;
  const ctaY = nameY + 90;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${REEL_W}" height="${REEL_H}">${brandBackground(input.colors)}
    ${input.logo ? `<rect x="${cx - logoSize / 2 - 30}" y="${logoTop - 30}" width="${logoSize + 60}" height="${logoSize + 60}" rx="70" fill="#ffffff"/>` : ""}
    ${svgText(input.brandName, { family: heading, weight: 800, size: 92, x: cx, y: input.logo ? nameY : logoTop + 200, anchor: "middle", fill: onBg })}
    ${cta ? `<rect x="${cx - ctaW / 2}" y="${(input.logo ? ctaY : logoTop + 290)}" width="${ctaW}" height="124" rx="62" fill="${accent}"/>
      ${svgText(cta, { family: body, weight: 800, size: ctaSize, x: cx, y: (input.logo ? ctaY : logoTop + 290) + 81, anchor: "middle", fill: readableOn(accent) })}` : ""}
    ${input.website ? svgText(input.website, { family: body, weight: 600, size: 44, x: cx, y: (input.logo ? ctaY : logoTop + 290) + 230, anchor: "middle", fill: onBg, opacity: 0.9 }) : ""}
  </svg>`;
  const layers = [];
  if (input.logo) {
    const logo = await sharp(input.logo).resize(logoSize, logoSize, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
    layers.push({ input: logo, left: Math.round(cx - logoSize / 2), top: logoTop });
  }
  return sharp(Buffer.from(svg)).composite(layers).png().toBuffer();
}
