import sharp, { type OverlayOptions } from "sharp";
import { DEFAULT_BODY_FONT, DEFAULT_HEADING_FONT, ensureFonts } from "@/lib/fonts";
import { creativeSpec, type Safe } from "@/lib/formats";
import { fitText, measure, svgText as textPath, textBlock } from "./measure";
import { escapeXml } from "./svg";

ensureFonts();

/*
 * Poster composer: the AI makes only the photo; this code lays out the brand's
 * colours, fonts, logo, headline, sub-line and button on a fixed template.
 * That is what makes a poster look designed instead of "AI-made", and the text
 * is always spelled right (AI image models are bad at text).
 * Runs locally with sharp; fonts come from assets/fonts (see src/lib/fonts.ts), so it is free,
 * looks the same everywhere, and Telugu / Hindi text is shaped correctly.
 */

import { isPosterTemplate, POSTER_TEMPLATES, TEMPLATE_INFO, type PosterTemplate } from "./poster-info";

export { isPosterTemplate, POSTER_TEMPLATES, TEMPLATE_INFO, type PosterTemplate };

export type PosterInput = {
  background: Buffer;
  width: number;
  height: number;
  template: PosterTemplate;
  headline: string;
  subline?: string | null;
  kicker?: string | null; // small label above the headline, e.g. "TIP", "PYQ 2024", "DAY 12"
  cta?: string | null;
  brandName: string;
  colors: string[];
  /** Brand heading and body fonts (bundled in assets/fonts). */
  fonts?: { heading: string; body: string };
  /** Areas the platform's own buttons cover (stories/reels); text stays out of them. */
  safe?: Safe;
  logo?: Buffer | null;
  footer?: string | null; // brand · city / website
};

export { escapeXml };

/** Character-count word wrap with balanced lines (kept for simple callers). */
export function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const first = greedy(text, maxChars);
  let best = first;
  for (let m = maxChars - 1; m >= 6; m--) {
    const attempt = greedy(text, m);
    if (attempt.length !== first.length) break;
    best = attempt;
  }
  if (best.length > maxLines) {
    const kept = best.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, "") + "…";
    return kept;
  }
  return best;
}

function greedy(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const w of text.trim().split(/\s+/)) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

const isHex = (c: string) => /^#[0-9a-f]{6}$/i.test(c);
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Pick black or white text for a background colour. */
export function readableOn(hex: string): string {
  if (!isHex(hex)) return "#ffffff";
  return luminance(hex) > 0.6 ? "#111111" : "#ffffff";
}

/** Mix two hex colours (t = share of b). */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** The first number in a headline ("199 days to Prelims" -> "199"), for the Big number template. */
export function bigNumber(headline: string): { number: string; rest: string } | null {
  const m = headline.match(/₹?\s?\d[\d,]*(?:\.\d+)?\s?(?:%|\+|L|K|k|Cr|cr|lakh|crore)?\+?/);
  if (!m) return null;
  const number = m[0].trim();
  const rest = (headline.slice(0, m.index) + " " + headline.slice(m.index! + m[0].length)).replace(/\s+/g, " ").replace(/^[\s:–-]+|[\s:–-]+$/g, "").trim();
  return { number, rest };
}

type Ctx = {
  W: number;
  H: number;
  u: number;
  pad: number;
  chip: number;
  landscape: boolean;
  primary: string;
  accent: string;
  ink: string;
  onPrimary: string;
  onAccent: string;
  heading: string;
  body: string;
  /** Safe area: top/bottom/right edges text must stay inside (stories, reels, thumbnails). */
  top: number;
  bottom: number;
  right: number;
  input: PosterInput;
};

type StackOpts = {
  width: number;
  align: "start" | "middle";
  head: string;
  headColor: string;
  subColor: string;
  kickerStyle: "pill" | "text" | "none";
  kickerColor: string; // pill fill or text colour
  kickerText?: string | null;
  headMax: number;
  headLines: number;
  subLines?: number;
  ctaFill?: string;
  ctaText?: string;
  noCta?: boolean;
};

/** Kicker, headline, sub-line and button stacked; returns its height and a draw(x, y) function. */
function stack(c: Ctx, o: StackOpts): { height: number; draw: (x: number, y: number) => string } {
  const { u } = c;
  const kicker = (o.kickerText ?? "").trim().toUpperCase();
  const kSize = Math.round(28 * u);
  const kickerH = kicker && o.kickerStyle !== "none" ? (o.kickerStyle === "pill" ? Math.round(kSize * 2) : kSize) + Math.round(24 * u) : 0;

  const head = o.head.trim()
    ? fitText(o.head, { family: c.heading, weight: 800 }, {
        maxWidth: o.width,
        maxLines: o.headLines,
        maxSize: Math.round(o.headMax * u),
        minSize: Math.round(40 * u),
      })
    : { size: 0, lines: [] as string[] };
  const headLH = Math.round(head.size * 1.14);
  const headH = head.lines.length ? (head.lines.length - 1) * headLH + Math.round(head.size * 0.98) : 0;

  const subText = (c.input.subline ?? "").trim();
  const sub = subText
    ? fitText(subText, { family: c.body, weight: 400 }, { maxWidth: o.width, maxLines: o.subLines ?? 3, maxSize: Math.round(36 * u), minSize: Math.round(26 * u) })
    : null;
  const subLH = sub ? Math.round(sub.size * 1.38) : 0;
  const subGap = headH ? Math.round(22 * u) : 0;
  const subH = sub ? subGap + (sub.lines.length - 1) * subLH + Math.round(sub.size * 1.05) : 0;

  const ctaLabel = o.noCta ? "" : (c.input.cta ?? "").trim().toUpperCase();
  const ctaSize = Math.round(30 * u);
  const ctaH = Math.round(82 * u);
  const ctaW = ctaLabel ? Math.round(measure(ctaLabel, { family: c.body, weight: 700, size: ctaSize }) + 72 * u) : 0;
  const ctaGap = headH || subH ? Math.round(36 * u) : 0;
  const ctaBlock = ctaLabel ? ctaGap + ctaH : 0;

  const height = kickerH + headH + subH + ctaBlock;
  const anchor = o.align;

  const draw = (x: number, y: number) => {
    const ax = anchor === "middle" ? x + o.width / 2 : x;
    let out = "";
    let cy = y;
    if (kickerH) {
      if (o.kickerStyle === "pill") {
        const kw = Math.round(measure(kicker, { family: c.body, weight: 700, size: kSize }) + 48 * u);
        const kh = Math.round(kSize * 2);
        const kx = anchor === "middle" ? ax - kw / 2 : x;
        out += `<rect x="${kx}" y="${cy}" width="${kw}" height="${kh}" rx="${kh / 2}" fill="${o.kickerColor}"/>`;
        out += textPath(kicker, { family: c.body, weight: 700, size: kSize, x: kx + kw / 2, y: cy + kh * 0.66, anchor: "middle", fill: readableOn(o.kickerColor) });
      } else {
        out += textPath(kicker, { family: c.body, weight: 700, size: kSize, x: ax, y: cy + kSize * 0.8, anchor, fill: o.kickerColor });
      }
      cy += kickerH;
    }
    out += textBlock(head.lines, { family: c.heading, weight: 800, size: head.size, x: ax, y: cy + Math.round(head.size * 0.78), lineHeight: headLH, anchor, fill: o.headColor });
    cy += headH;
    if (sub) {
      out += textBlock(sub.lines, { family: c.body, weight: 400, size: sub.size, x: ax, y: cy + subGap + Math.round(sub.size * 0.8), lineHeight: subLH, anchor, fill: o.subColor });
      cy += subH;
    }
    if (ctaLabel) {
      const fill = o.ctaFill ?? c.accent;
      const bx = anchor === "middle" ? ax - ctaW / 2 : x;
      const by = cy + ctaGap;
      out += `<rect x="${bx}" y="${by}" width="${ctaW}" height="${ctaH}" rx="${ctaH / 2}" fill="${fill}"/>`;
      out += textPath(ctaLabel, { family: c.body, weight: 700, size: ctaSize, x: bx + ctaW / 2, y: by + ctaH * 0.64, anchor: "middle", fill: o.ctaText ?? readableOn(fill) });
    }
    return out;
  };
  return { height, draw };
}

function footerText(c: Ctx, x: number, y: number, fill: string, anchor: "start" | "middle" | "end" = "end", opacity = 0.9) {
  const text = c.input.footer ?? c.input.brandName;
  return textPath(text, { family: c.body, weight: 600, size: Math.round(24 * c.u), x, y, anchor, fill, opacity });
}

type Layout = {
  /** "photo" = the AI image fills the poster; otherwise a solid colour. */
  base: "photo" | string;
  /** Put the photo into a (rounded) frame instead. */
  photo?: { x: number; y: number; w: number; h: number; r: number };
  svg: string;
};

function layout(c: Ctx): Layout {
  const { W, H, u, pad, chip, landscape, primary, accent, ink, onPrimary } = c;
  const t = c.input.template;
  // Text stays inside the safe area (B = lowest text line, R = right edge); colour fills still reach the edges.
  const B = c.bottom;
  const R = c.right;
  const logoBottom = c.top + chip;
  // Brand colour as text on white only when it is dark enough.
  const headOnLight = luminance(primary) < 0.45 ? primary : ink;

  switch (t) {
    case "top": {
      const s = stack(c, { width: R - pad * 2, align: "start", head: c.input.headline, headColor: "#ffffff", subColor: "#ffffff", kickerStyle: "pill", kickerColor: accent, kickerText: c.input.kicker, headMax: 84, headLines: 3 });
      const y0 = logoBottom + Math.round(pad * 0.5);
      const barH = Math.round(70 * u);
      return {
        base: "photo",
        svg: `<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.78"/><stop offset="0.7" stop-color="#000" stop-opacity="0.45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs>
          <rect x="0" y="0" width="${W}" height="${y0 + s.height + pad * 1.6}" fill="url(#fade)"/>
          ${s.draw(pad, y0)}
          <rect x="0" y="${B - barH}" width="${W}" height="${barH}" fill="${primary}"/>
          ${footerText(c, W / 2, B - barH * 0.38, onPrimary, "middle")}`,
      };
    }
    case "center": {
      const cardW = R - pad * 2;
      const inner = cardW - pad * 1.4;
      const s = stack(c, { width: inner, align: "middle", head: c.input.headline, headColor: headOnLight, subColor: "#374151", kickerStyle: "text", kickerColor: luminance(accent) < 0.6 ? accent : primary, kickerText: c.input.kicker, headMax: 86, headLines: 4 });
      const cardH = Math.round(s.height + pad * 1.5);
      const cy = Math.max(logoBottom + pad * 0.4, Math.round((B - cardH) / 2));
      return {
        base: "photo",
        svg: `<rect x="0" y="0" width="${W}" height="${H}" fill="#000" fill-opacity="0.22"/>
          <rect x="${pad}" y="${cy}" width="${cardW}" height="${cardH}" rx="${Math.round(36 * u)}" fill="#ffffff" fill-opacity="0.95"/>
          <rect x="${pad}" y="${cy + Math.round(36 * u)}" width="${Math.round(12 * u)}" height="${cardH - Math.round(72 * u)}" rx="${Math.round(6 * u)}" fill="${primary}"/>
          ${s.draw(pad + pad * 0.7, cy + pad * 0.75)}
          ${footerText(c, W / 2, B - pad * 0.6, "#ffffff", "middle")}`,
      };
    }
    case "split": {
      if (landscape) {
        const pw = Math.round(W * 0.5);
        const s = stack(c, { width: pw - pad * 2, align: "start", head: c.input.headline, headColor: onPrimary, subColor: onPrimary, kickerStyle: "pill", kickerColor: accent, kickerText: c.input.kicker, headMax: 70, headLines: 4 });
        return {
          base: primary,
          photo: { x: 0, y: 0, w: pw, h: H, r: 0 },
          svg: `<rect x="${pw}" y="0" width="${Math.round(8 * u)}" height="${H}" fill="${accent}"/>
            ${s.draw(pw + pad, Math.max(pad, Math.round((B - s.height) / 2)))}
            ${footerText(c, R - pad, B - pad * 0.5, onPrimary)}`,
        };
      }
      const ph = Math.round(H * (H / W > 1.5 ? 0.52 : 0.56));
      const s = stack(c, { width: R - pad * 2, align: "start", head: c.input.headline, headColor: onPrimary, subColor: onPrimary, kickerStyle: "pill", kickerColor: accent, kickerText: c.input.kicker, headMax: 80, headLines: 3 });
      const room = B - ph - Math.round(60 * u);
      const y0 = ph + Math.max(Math.round(pad * 0.7), Math.round((room - s.height) / 2));
      return {
        base: primary,
        photo: { x: 0, y: 0, w: W, h: ph, r: 0 },
        svg: `<rect x="0" y="${ph}" width="${W}" height="${Math.round(10 * u)}" fill="${accent}"/>
          ${s.draw(pad, y0)}
          ${footerText(c, R - pad, B - pad * 0.5, onPrimary)}`,
      };
    }
    case "bignumber": {
      const parsed = bigNumber(c.input.headline);
      if (!parsed) return layout({ ...c, input: { ...c.input, template: "tip" } });
      const num = fitText(parsed.number, { family: c.heading, weight: 800 }, { maxWidth: R - pad * 2, maxLines: 1, maxSize: Math.round((landscape ? 260 : 340) * u), minSize: Math.round(120 * u) });
      const s = stack(c, { width: R - pad * 2, align: "middle", head: parsed.rest || c.input.brandName, headColor: onPrimary, subColor: onPrimary, kickerStyle: "none", kickerColor: accent, headMax: 64, headLines: 2, subLines: 2 });
      const kicker = (c.input.kicker ?? "").toUpperCase();
      const kSize = Math.round(30 * u);
      const kH = kicker ? Math.round(kSize + 20 * u) : 0;
      const numH = Math.round(num.size * 0.82);
      const total = kH + numH + Math.round(28 * u) + s.height;
      const y0 = Math.max(logoBottom + pad * 0.3, Math.round((B - total) / 2));
      return {
        base: "photo",
        svg: `<rect x="0" y="0" width="${W}" height="${H}" fill="${primary}" fill-opacity="0.88"/>
          ${kicker ? textPath(kicker, { family: c.body, weight: 700, size: kSize, x: W / 2, y: y0 + kSize * 0.8, anchor: "middle", fill: accent }) : ""}
          ${textPath(num.lines[0], { family: c.heading, weight: 800, size: num.size, x: W / 2, y: y0 + kH + numH, anchor: "middle", fill: accent })}
          ${s.draw(pad, y0 + kH + numH + Math.round(28 * u))}
          ${footerText(c, W / 2, B - pad * 0.6, onPrimary, "middle")}`,
      };
    }
    case "tip": {
      const paper = mix(primary, "#ffffff", 0.93);
      const barH = Math.round(70 * u);
      if (landscape) {
        const fw = Math.round(W * 0.42);
        const s = stack(c, { width: R - fw - pad * 3, align: "start", head: c.input.headline, headColor: headOnLight, subColor: "#374151", kickerStyle: "pill", kickerColor: primary, kickerText: c.input.kicker || "Tip", headMax: 64, headLines: 4, ctaFill: primary });
        return {
          base: paper,
          photo: { x: R - fw - pad, y: pad, w: fw, h: B - pad * 2 - barH, r: Math.round(28 * u) },
          svg: `${s.draw(pad, Math.max(logoBottom + pad * 0.3, Math.round((B - barH - s.height) / 2)))}
            <rect x="0" y="${B - barH}" width="${W}" height="${barH}" fill="${primary}"/>
            ${footerText(c, W / 2, B - barH * 0.38, onPrimary, "middle")}`,
        };
      }
      const fy = logoBottom + Math.round(pad * 0.4);
      // Photo takes part of the space between the logo and the bottom bar; the text gets the rest.
      const fh = Math.round((B - barH - fy) * (H / W > 1.5 ? 0.42 : 0.44));
      const s = stack(c, { width: R - pad * 2, align: "start", head: c.input.headline, headColor: headOnLight, subColor: "#374151", kickerStyle: "pill", kickerColor: primary, kickerText: c.input.kicker || "Tip", headMax: 74, headLines: 3, ctaFill: primary });
      return {
        base: paper,
        photo: { x: pad, y: fy, w: R - pad * 2, h: fh, r: Math.round(32 * u) },
        svg: `${s.draw(pad, fy + fh + Math.round(pad * 0.6))}
          <rect x="0" y="${B - barH}" width="${W}" height="${barH}" fill="${primary}"/>
          ${footerText(c, W / 2, B - barH * 0.38, onPrimary, "middle")}`,
      };
    }
    case "question": {
      const cardW = R - pad * 2;
      // The question sits in a white card; the sub-line and button go under the card.
      const card = stack({ ...c, input: { ...c.input, subline: null } }, { width: cardW - pad * 1.2, align: "middle", head: c.input.headline, headColor: ink, subColor: ink, kickerStyle: "none", kickerColor: accent, headMax: 66, headLines: 6, noCta: true });
      const below = stack(c, { width: cardW, align: "middle", head: "", headColor: onPrimary, subColor: onPrimary, kickerStyle: "none", kickerColor: accent, headMax: 40, headLines: 1, subLines: 2 });
      const kicker = (c.input.kicker || "Question of the day").toUpperCase();
      const kSize = Math.round(32 * u);
      const cH = Math.round(card.height + pad * 1.2);
      const gap = Math.round(30 * u);
      const total = kSize + gap + cH + Math.round(16 * u) + below.height;
      const y0 = Math.max(logoBottom + pad * 0.4, Math.round((B - Math.round(60 * u) - total) / 2));
      const cardY = y0 + kSize + gap;
      return {
        base: primary,
        svg: `<circle cx="${W - pad}" cy="${pad}" r="${Math.round(220 * u)}" fill="${accent}" fill-opacity="0.18"/>
          <circle cx="${pad}" cy="${H - pad}" r="${Math.round(160 * u)}" fill="#ffffff" fill-opacity="0.07"/>
          ${textPath(kicker, { family: c.body, weight: 700, size: kSize, x: W / 2, y: y0 + kSize * 0.8, anchor: "middle", fill: accent })}
          <rect x="${pad}" y="${cardY}" width="${cardW}" height="${cH}" rx="${Math.round(32 * u)}" fill="#ffffff"/>
          ${card.draw(pad + pad * 0.6, cardY + pad * 0.6)}
          ${below.draw(pad, cardY + cH + Math.round(16 * u))}
          ${footerText(c, W / 2, B - pad * 0.6, onPrimary, "middle")}`,
      };
    }
    case "announcement": {
      const s = stack(c, { width: R - pad * 2.4, align: "middle", head: c.input.headline, headColor: "#ffffff", subColor: "#ffffff", kickerStyle: "pill", kickerColor: accent, kickerText: c.input.kicker || "New", headMax: 92, headLines: 3 });
      const y0 = Math.max(logoBottom + pad * 0.3, Math.round((B - s.height) / 2));
      const inset = Math.round(pad * 0.45);
      return {
        base: "photo",
        svg: `<rect x="0" y="0" width="${W}" height="${H}" fill="#000" fill-opacity="0.5"/>
          <rect x="0" y="0" width="${W}" height="${H}" fill="${primary}" fill-opacity="0.25"/>
          <rect x="${inset}" y="${inset}" width="${W - inset * 2}" height="${H - inset * 2}" rx="${Math.round(24 * u)}" fill="none" stroke="${accent}" stroke-width="${Math.round(8 * u)}"/>
          ${s.draw(pad * 1.2, y0)}
          ${footerText(c, W / 2, B - pad * 0.75, "#ffffff", "middle")}`,
      };
    }
    case "quote": {
      const markSize = Math.round(240 * u);
      const s = stack(c, { width: R - pad * 2, align: "start", head: c.input.headline, headColor: onPrimary, subColor: accent, kickerStyle: "none", kickerColor: accent, headMax: 70, headLines: 6, subLines: 2, noCta: true });
      const total = Math.round(markSize * 0.55) + s.height;
      const y0 = Math.max(logoBottom + pad * 0.4, Math.round((B - total) / 2));
      return {
        base: "photo",
        svg: `<rect x="0" y="0" width="${W}" height="${H}" fill="${primary}" fill-opacity="0.9"/>
          ${textPath("“", { family: c.heading, weight: 800, size: markSize, x: pad - Math.round(10 * u), y: y0 + Math.round(markSize * 0.78), fill: accent })}
          ${s.draw(pad, y0 + Math.round(markSize * 0.55))}
          ${footerText(c, R - pad, B - pad * 0.6, onPrimary)}`,
      };
    }
    case "band":
    default: {
      const s = stack(c, { width: R - pad * 2, align: "start", head: c.input.headline, headColor: onPrimary, subColor: onPrimary, kickerStyle: "text", kickerColor: luminance(accent) > 0.25 ? accent : "#ffffff", kickerText: c.input.kicker, headMax: 78, headLines: 3 });
      const footerH = Math.round(54 * u);
      const bandH = Math.round(s.height + pad * 1.4 + footerH) + (H - B);
      const y0 = H - bandH;
      return {
        base: "photo",
        svg: `<rect x="0" y="${y0}" width="${W}" height="${bandH}" fill="${primary}" fill-opacity="0.95"/>
          <rect x="0" y="${y0}" width="${W}" height="${Math.round(10 * u)}" fill="${accent}"/>
          ${s.draw(pad, y0 + Math.round(pad * 0.8))}
          ${footerText(c, R - pad, B - pad * 0.5, onPrimary, "end", 0.85)}`,
      };
    }
  }
}

export async function composePoster(input: PosterInput): Promise<Buffer> {
  const { width: W, height: H } = input;
  const palette = input.colors.filter(isHex);
  const primary = palette[0] ?? "#4F46E5";
  const accent = palette[1] ?? "#F59E0B";
  const u = Math.min(W, H) / 1080;
  const heading = input.fonts?.heading ?? DEFAULT_HEADING_FONT;
  const body = input.fonts?.body ?? DEFAULT_BODY_FONT;
  const safe = input.safe ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const c: Ctx = {
    W,
    H,
    u,
    pad: Math.round(Math.min(W, H) * 0.07),
    chip: Math.round(124 * u),
    landscape: W > H * 1.15,
    primary,
    accent,
    ink: "#14141f",
    onPrimary: readableOn(primary),
    onAccent: readableOn(accent),
    heading,
    body,
    top: Math.max(Math.round(Math.min(W, H) * 0.07 * 0.7), safe.top),
    bottom: H - safe.bottom,
    right: W - safe.right,
    input: { ...input, headline: input.headline.trim() || input.brandName },
  };
  const l = layout(c);

  let base: Buffer;
  if (l.base === "photo") {
    base = await sharp(input.background).resize(W, H, { fit: "cover", position: "attention" }).png().toBuffer();
  } else {
    const [r, g, b] = rgb(isHex(l.base) ? l.base : "#ffffff");
    base = await sharp({ create: { width: W, height: H, channels: 4, background: { r, g, b, alpha: 1 } } }).png().toBuffer();
  }

  const layers: OverlayOptions[] = [];
  if (l.photo) {
    const { x, y, w, h, r } = l.photo;
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" fill="#fff"/></svg>`);
    const photo = await sharp(input.background)
      .resize(Math.round(w), Math.round(h), { fit: "cover", position: "attention" })
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();
    layers.push({ input: photo, left: Math.round(x), top: Math.round(y) });
  }
  layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${l.svg}</svg>`), left: 0, top: 0 });

  // Logo (or brand name) top-left on a white rounded chip.
  const chipPad = Math.round(14 * u);
  const top = c.top;
  const lightBase = l.base !== "photo" && luminance(l.base) > 0.8;
  const border = lightBase ? ` stroke="#e5e7eb" stroke-width="${Math.max(1, Math.round(2 * u))}"` : "";
  if (input.logo) {
    const logo = await sharp(input.logo)
      .resize(c.chip - chipPad * 2, c.chip - chipPad * 2, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toBuffer();
    layers.push({
      input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${c.chip}" height="${c.chip}"><rect width="${c.chip}" height="${c.chip}" rx="${Math.round(26 * u)}" fill="#ffffff" fill-opacity="0.96"${border}/></svg>`),
      left: c.pad,
      top,
    });
    layers.push({ input: logo, left: c.pad + chipPad, top: top + chipPad });
  } else {
    const nameSize = Math.round(32 * u);
    const st = { family: heading, weight: 800 as const, size: nameSize };
    const w = Math.round(measure(input.brandName, st) + 52 * u);
    const h = Math.round(nameSize * 2);
    layers.push({
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${h / 2}" fill="#ffffff" fill-opacity="0.96"${border}/>${textPath(input.brandName, { ...st, x: w / 2, y: h * 0.66, anchor: "middle", fill: luminance(primary) < 0.6 ? primary : "#14141f" })}</svg>`,
      ),
      left: c.pad,
      top,
    });
  }

  return sharp(base).composite(layers).png().toBuffer();
}

/** Pixel size for each platform + format. */
export function posterSize(platform: string, format: string): { width: number; height: number } {
  const { width, height } = creativeSpec(platform, format);
  return { width, height };
}
