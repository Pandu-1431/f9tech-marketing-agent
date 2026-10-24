import sharp, { type OverlayOptions } from "sharp";

/*
 * Poster composer: background image + brand logo + headline + CTA + brand name,
 * in the brand's colours. Runs locally with sharp, so it is free and the text is
 * always spelled correctly (AI image models are bad at text).
 */

export const POSTER_TEMPLATES = ["band", "top", "center"] as const;
export type PosterTemplate = (typeof POSTER_TEMPLATES)[number];

export type PosterInput = {
  background: Buffer;
  width: number;
  height: number;
  template: PosterTemplate;
  headline: string;
  cta?: string | null;
  brandName: string;
  colors: string[];
  logo?: Buffer | null;
  footer?: string | null; // city / website
};

const FONT = "Poppins, Inter, 'Helvetica Neue', Helvetica, Arial, 'DejaVu Sans', sans-serif";

export function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

/** Word wrap with balanced line lengths (no single orphan word on the last line). */
export function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const first = greedy(text, maxChars);
  let best = first;
  for (let m = maxChars - 1; m >= 6; m--) {
    const attempt = greedy(text, m);
    if (attempt.length !== first.length) break;
    best = attempt;
  }
  return clamp(best, maxLines);
}

function greedy(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function clamp(lines: string[], maxLines: number): string[] {
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, "") + "…";
    return kept;
  }
  return lines;
}

const isHex = (c: string) => /^#[0-9a-f]{6}$/i.test(c);

/** Pick black or white text for a background colour. */
export function readableOn(hex: string): string {
  if (!isHex(hex)) return "#ffffff";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? "#111111" : "#ffffff";
}

export async function composePoster(input: PosterInput): Promise<Buffer> {
  const { width: W, height: H } = input;
  const palette = input.colors.filter(isHex);
  const primary = palette[0] ?? "#4F46E5";
  const accent = palette[1] ?? "#F59E0B";
  const onPrimary = readableOn(primary);
  const onAccent = readableOn(accent);
  const pad = Math.round(W * 0.06);
  const unit = W / 1080;

  const bg = await sharp(input.background).resize(W, H, { fit: "cover", position: "attention" }).toBuffer();

  const headlineSize = Math.round((input.template === "center" ? 82 : 76) * unit);
  const maxChars = Math.floor((W - pad * 2) / (headlineSize * 0.53));
  const lines = wrap(input.headline, maxChars, 3);
  const lineH = Math.round(headlineSize * 1.12);
  const ctaSize = Math.round(34 * unit);
  const cta = input.cta ? escapeXml(input.cta.toUpperCase()) : "";
  const ctaW = cta ? Math.round(cta.length * ctaSize * 0.66 + 56 * unit) : 0;
  const ctaH = Math.round(ctaSize * 2);
  const footer = escapeXml(input.footer ?? input.brandName);

  let overlay = "";
  if (input.template === "band") {
    const bandH = Math.round(pad * 1.4 + lines.length * lineH + (cta ? ctaH + pad * 0.6 : 0) + 40 * unit);
    const y0 = H - bandH;
    overlay = `
      <rect x="0" y="${y0}" width="${W}" height="${bandH}" fill="${primary}" fill-opacity="0.94"/>
      <rect x="0" y="${y0}" width="${W}" height="${Math.round(10 * unit)}" fill="${accent}"/>
      ${lines.map((l, i) => `<text x="${pad}" y="${y0 + pad + headlineSize * 0.8 + i * lineH}" font-family="${FONT}" font-weight="800" font-size="${headlineSize}" fill="${onPrimary}">${escapeXml(l)}</text>`).join("")}
      ${cta ? `<rect x="${pad}" y="${y0 + pad + lines.length * lineH + pad * 0.3}" width="${ctaW}" height="${ctaH}" rx="${ctaH / 2}" fill="${accent}"/>
      <text x="${pad + ctaW / 2}" y="${y0 + pad + lines.length * lineH + pad * 0.3 + ctaH * 0.64}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${ctaSize}" fill="${onAccent}">${cta}</text>` : ""}
      <text x="${W - pad}" y="${H - pad * 0.6}" text-anchor="end" font-family="${FONT}" font-weight="600" font-size="${Math.round(26 * unit)}" fill="${onPrimary}" fill-opacity="0.85">${footer}</text>`;
  } else if (input.template === "top") {
    const textTop = Math.round(pad * 0.7 + 150 * unit + pad * 0.5 + headlineSize * 0.8);
    const blockH = Math.round(textTop + lines.length * lineH + (cta ? ctaH + pad : 0) + pad);
    overlay = `
      <defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.75"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs>
      <rect x="0" y="0" width="${W}" height="${blockH}" fill="url(#fade)"/>
      ${lines.map((l, i) => `<text x="${pad}" y="${textTop + i * lineH}" font-family="${FONT}" font-weight="800" font-size="${headlineSize}" fill="#ffffff">${escapeXml(l)}</text>`).join("")}
      ${cta ? `<rect x="${pad}" y="${textTop + (lines.length - 1) * lineH + pad * 0.6}" width="${ctaW}" height="${ctaH}" rx="${ctaH / 2}" fill="${accent}"/>
      <text x="${pad + ctaW / 2}" y="${textTop + (lines.length - 1) * lineH + pad * 0.6 + ctaH * 0.64}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${ctaSize}" fill="${onAccent}">${cta}</text>` : ""}
      <rect x="0" y="${H - Math.round(70 * unit)}" width="${W}" height="${Math.round(70 * unit)}" fill="${primary}"/>
      <text x="${W / 2}" y="${H - Math.round(25 * unit)}" text-anchor="middle" font-family="${FONT}" font-weight="600" font-size="${Math.round(28 * unit)}" fill="${onPrimary}">${footer}</text>`;
  } else {
    const cardW = W - pad * 2;
    const cardH = Math.round(pad * 0.8 + lines.length * lineH + (cta ? pad * 0.1 + ctaH : 0) + pad * 0.8);
    const cx = pad;
    const cy = Math.round((H - cardH) / 2);
    overlay = `
      <rect x="0" y="0" width="${W}" height="${H}" fill="#000" fill-opacity="0.18"/>
      <rect x="${cx}" y="${cy}" width="${cardW}" height="${cardH}" rx="${Math.round(36 * unit)}" fill="#ffffff" fill-opacity="0.93"/>
      <rect x="${cx}" y="${cy}" width="${Math.round(14 * unit)}" height="${cardH}" rx="${Math.round(7 * unit)}" fill="${primary}"/>
      ${lines.map((l, i) => `<text x="${W / 2}" y="${cy + pad * 0.8 + headlineSize * 0.8 + i * lineH}" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="${headlineSize}" fill="${primary}">${escapeXml(l)}</text>`).join("")}
      ${cta ? `<rect x="${(W - ctaW) / 2}" y="${cy + pad * 0.8 + lines.length * lineH + pad * 0.1}" width="${ctaW}" height="${ctaH}" rx="${ctaH / 2}" fill="${accent}"/>
      <text x="${W / 2}" y="${cy + pad * 0.8 + lines.length * lineH + pad * 0.1 + ctaH * 0.64}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${ctaSize}" fill="${onAccent}">${cta}</text>` : ""}
      <text x="${W / 2}" y="${H - pad * 0.7}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${Math.round(30 * unit)}" fill="#ffffff">${footer}</text>`;
  }

  const layers: OverlayOptions[] = [{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${overlay}</svg>`) }];

  // Logo (or brand name) top-left on a white rounded chip.
  const chip = Math.round(150 * unit);
  const chipPad = Math.round(16 * unit);
  if (input.logo) {
    const logo = await sharp(input.logo)
      .resize(chip - chipPad * 2, chip - chipPad * 2, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toBuffer();
    layers.push({
      input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${chip}" height="${chip}"><rect width="${chip}" height="${chip}" rx="${Math.round(28 * unit)}" fill="#ffffff" fill-opacity="0.95"/></svg>`),
      left: pad,
      top: Math.round(pad * 0.7),
    });
    layers.push({ input: logo, left: pad + chipPad, top: Math.round(pad * 0.7) + chipPad });
  } else {
    const name = escapeXml(input.brandName);
    const nameSize = Math.round(32 * unit);
    const w = Math.round(name.length * nameSize * 0.62 + 48 * unit);
    layers.push({
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${Math.round(nameSize * 2)}"><rect width="${w}" height="${Math.round(nameSize * 2)}" rx="${nameSize}" fill="#ffffff" fill-opacity="0.95"/><text x="${w / 2}" y="${Math.round(nameSize * 1.33)}" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="${nameSize}" fill="${primary}">${name}</text></svg>`,
      ),
      left: pad,
      top: Math.round(pad * 0.7),
    });
  }

  return sharp(bg).composite(layers).png().toBuffer();
}

/** Pixel size for each platform + format. */
export function posterSize(platform: string, format: string): { width: number; height: number } {
  if (format === "story" || format === "reel") return { width: 1080, height: 1920 };
  if (platform === "youtube") return { width: 1280, height: 720 };
  if (platform === "google_business") return { width: 1200, height: 900 };
  if (platform === "instagram") return { width: 1080, height: 1350 };
  return { width: 1080, height: 1080 };
}
