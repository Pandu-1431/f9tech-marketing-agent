import fs from "node:fs";
import path from "node:path";
import opentype, { type Font } from "opentype.js";
import { casedFor, fontStack } from "@/lib/font-choices";
import { escapeXml } from "./svg";

/*
 * Text measuring for poster layout. Text is RENDERED by sharp (librsvg + Pango, fonts from
 * assets/fonts via fontconfig, so Telugu and Hindi are shaped correctly). Here we only MEASURE
 * it with the same font files, so lines wrap and shrink to fit their box instead of guessing.
 */

export type Weight = 400 | 600 | 700 | 800;
export type TextStyle = { family: string; weight: Weight; size: number };

// Static files per weight where we have them; one variable file otherwise (measured at its default).
const FILES: Record<string, Partial<Record<Weight, string>>> = {
  Poppins: { 400: "Poppins-Regular.ttf", 600: "Poppins-SemiBold.ttf", 700: "Poppins-Bold.ttf", 800: "Poppins-ExtraBold.ttf" },
  Inter: { 400: "Inter.ttf" },
  Montserrat: { 400: "Montserrat.ttf" },
  "Bebas Neue": { 400: "BebasNeue-Regular.ttf" },
  "Playfair Display": { 400: "PlayfairDisplay.ttf" },
  "Noto Sans Telugu": { 400: "NotoSansTelugu.ttf" },
  Ramabhadra: { 400: "Ramabhadra-Regular.ttf" },
  "Noto Sans Devanagari": { 400: "NotoSansDevanagari.ttf" },
  "Baloo 2": { 400: "Baloo2.ttf" },
};

const cache = new Map<string, Font | null>();

function load(file: string): Font | null {
  if (cache.has(file)) return cache.get(file)!;
  let font: Font | null = null;
  try {
    const buf = fs.readFileSync(path.join(process.cwd(), "assets", "fonts", file));
    font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  } catch {
    font = null; // missing or unreadable: fall back to an estimate
  }
  cache.set(file, font);
  return font;
}

/** The font file to measure with, and how much wider bold renders than the file's default. */
function pick(family: string, weight: Weight, text: string): { font: Font | null; boldFactor: number } {
  const fam = /[ఀ-౿]/.test(text) ? "Noto Sans Telugu" : /[ऀ-ॿ]/.test(text) ? "Noto Sans Devanagari" : FILES[family] ? family : "Poppins";
  const files = FILES[fam]!;
  if (files[weight]) return { font: load(files[weight]!), boldFactor: 1 };
  const nearest = (Object.keys(files).map(Number) as Weight[]).sort((a, b) => Math.abs(a - weight) - Math.abs(b - weight))[0];
  // Variable fonts are measured at their default (regular) instance; bold glyphs are wider.
  const boldFactor = weight >= 800 ? 1.1 : weight >= 700 ? 1.07 : weight >= 600 ? 1.04 : 1;
  return { font: load(files[nearest]!), boldFactor };
}

export function measure(text: string, s: TextStyle): number {
  const shown = casedFor(s.family, text);
  const { font, boldFactor } = pick(s.family, s.weight, shown);
  const w = font ? font.getAdvanceWidth(shown, s.size) : shown.length * s.size * 0.6;
  return w * boldFactor;
}

/** One line of SVG text in the brand font (with Telugu / Hindi fallbacks). */
export function svgText(
  text: string,
  s: TextStyle & { x: number; y: number; fill: string; anchor?: "start" | "middle" | "end"; opacity?: number },
): string {
  if (!text) return "";
  const shown = casedFor(s.family, text);
  const anchor = s.anchor && s.anchor !== "start" ? ` text-anchor="${s.anchor}"` : "";
  const opacity = s.opacity != null && s.opacity < 1 ? ` fill-opacity="${s.opacity}"` : "";
  return `<text x="${Math.round(s.x)}" y="${Math.round(s.y)}"${anchor} font-family="${fontStack(s.family, shown)}" font-weight="${s.weight}" font-size="${s.size}" fill="${s.fill}"${opacity}>${escapeXml(shown)}</text>`;
}

/** Word wrap by measured width, with balanced lines. Returns null when it doesn't fit in maxLines. */
export function wrapToWidth(text: string, s: TextStyle, maxWidth: number, maxLines: number): string[] | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const fits = (line: string) => measure(line, s) <= maxWidth;
  if (!words.every(fits)) return null;

  const greedy = (limit: number): string[] => {
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (line && measure(next, s) > limit) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };

  const first = greedy(maxWidth);
  if (first.length > maxLines) return null;
  // Balance: shrink the limit while the line count stays the same (no lonely last word).
  let best = first;
  for (let limit = maxWidth * 0.95; limit > maxWidth * 0.4; limit *= 0.95) {
    const attempt = greedy(limit);
    if (attempt.length !== first.length || !attempt.every(fits)) break;
    best = attempt;
  }
  return best;
}

/**
 * Biggest font size (from max down to min) at which the text fits the box.
 * At min size it is cut with "…" so nothing ever runs off the poster.
 */
export function fitText(
  text: string,
  s: { family: string; weight: Weight },
  box: { maxWidth: number; maxLines: number; maxSize: number; minSize: number },
): { size: number; lines: string[] } {
  // Small safety margin: the renderer's kerning can differ slightly from the measurement.
  const maxWidth = box.maxWidth * 0.97;
  for (let size = box.maxSize; size >= box.minSize; size = Math.floor(size * 0.93)) {
    const lines = wrapToWidth(text, { ...s, size }, maxWidth, box.maxLines);
    if (lines) return { size, lines };
  }
  const size = box.minSize;
  const st = { ...s, size };
  const lines: string[] = [];
  let line = "";
  let used = 0;
  const words = text.trim().split(/\s+/);
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && measure(next, st) > maxWidth) {
      lines.push(line);
      if (lines.length === box.maxLines) break;
      line = w;
    } else line = next;
    used++;
  }
  if (lines.length < box.maxLines && line) lines.push(line);
  const cut = used < words.length || lines.length > box.maxLines;
  const out = lines.slice(0, box.maxLines).map((l) => {
    let t = l;
    while (t.length > 1 && measure(t, st) > maxWidth) t = t.slice(0, -1);
    return t;
  });
  if (cut && out.length) {
    let last = out[out.length - 1];
    while (last && measure(`${last}…`, st) > maxWidth) last = last.replace(/\s*\S$/, "");
    out[out.length - 1] = `${last.replace(/[\s,.;:-]+$/, "")}…`;
  }
  return { size, lines: out };
}

/** Several lines of text. y = baseline of the first line. */
export function textBlock(
  lines: string[],
  s: TextStyle & { x: number; y: number; fill: string; lineHeight: number; anchor?: "start" | "middle" | "end"; opacity?: number },
): string {
  return lines.map((l, i) => svgText(l, { ...s, y: s.y + i * s.lineHeight })).join("");
}
