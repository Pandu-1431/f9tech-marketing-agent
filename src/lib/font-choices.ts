/*
 * Brand typography. Posters and video frames are SVG rendered by sharp (librsvg + Pango + HarfBuzz),
 * which finds fonts through fontconfig. We ship open-licence fonts (SIL OFL, from Google Fonts) in
 * assets/fonts and point fontconfig at them, so the SAME fonts render on the Mac, the server and in
 * tests — and Telugu / Hindi text is shaped correctly.
 */

export type FontChoice = { family: string; label: string; use: "heading" | "body" | "both"; script: "latin" | "telugu" | "devanagari" };

export const FONT_CHOICES: FontChoice[] = [
  { family: "Poppins", label: "Poppins — round, friendly (default heading)", use: "both", script: "latin" },
  { family: "Inter", label: "Inter — clean, very readable (default body)", use: "both", script: "latin" },
  { family: "Montserrat", label: "Montserrat — bold, modern", use: "both", script: "latin" },
  { family: "Bebas Neue", label: "Bebas Neue — tall capitals, headlines only", use: "heading", script: "latin" },
  { family: "Playfair Display", label: "Playfair Display — elegant serif", use: "heading", script: "latin" },
  { family: "Noto Sans Telugu", label: "Noto Sans Telugu — Telugu text", use: "both", script: "telugu" },
  { family: "Ramabhadra", label: "Ramabhadra — Telugu display", use: "heading", script: "telugu" },
  { family: "Noto Sans Devanagari", label: "Noto Sans Devanagari — Hindi text", use: "both", script: "devanagari" },
  { family: "Baloo 2", label: "Baloo 2 — Hindi display, playful", use: "heading", script: "devanagari" },
];

export const DEFAULT_HEADING_FONT = "Poppins";
export const DEFAULT_BODY_FONT = "Inter";
const KNOWN = new Set(FONT_CHOICES.map((f) => f.family));
const BEBAS_HAS_LOWER = false;

/** The brand's heading and body fonts (stored as brand.fonts[0] and [1]); unknown names fall back. */
export function brandFonts(fonts: string[] | null | undefined): { heading: string; body: string } {
  const [h, b] = (fonts ?? []).map((f) => f.trim());
  return { heading: h && KNOWN.has(h) ? h : DEFAULT_HEADING_FONT, body: b && KNOWN.has(b) ? b : DEFAULT_BODY_FONT };
}

/**
 * CSS font-family list for SVG text: the chosen font first, then the right script font when the
 * text is Telugu or Hindi (Pango also falls back per character), then safe defaults.
 */
export function fontStack(family: string, text = ""): string {
  const list = [family];
  if (/[ఀ-౿]/.test(text)) list.push("Noto Sans Telugu");
  if (/[ऀ-ॿ]/.test(text)) list.push("Noto Sans Devanagari");
  list.push("Poppins", "Inter", "Noto Sans Telugu", "Noto Sans Devanagari", "DejaVu Sans", "sans-serif");
  return Array.from(new Set(list))
    .map((f) => (f.includes(" ") ? `'${f}'` : f))
    .join(", ");
}

/** Bebas Neue has capitals only; other fonts keep the text as written. */
export function casedFor(family: string, text: string): string {
  return family === "Bebas Neue" && !BEBAS_HAS_LOWER ? text.toUpperCase() : text;
}

/** Average glyph width as a share of font size, for line wrapping (narrow fonts fit more). */
export function widthFactor(family: string): number {
  if (family === "Bebas Neue") return 0.42;
  if (family === "Playfair Display") return 0.52;
  if (family === "Montserrat") return 0.6;
  return 0.56;
}

