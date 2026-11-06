import type { Brand } from "@/db/schema";

/*
 * House style for every brand: Indian look and simple, clear language.
 * The Brand Kit adds to these rules (visual style, tone, do / don't); it never removes them.
 */

/** Plain-language rules every caption, poster line and voiceover follows. */
export function simpleLanguageRules(brand: Pick<Brand, "language">): string[] {
  const english = /english/i.test(brand.language || "English");
  return [
    "LANGUAGE RULES (always follow):",
    english
      ? "- Simple Indian English that a 15-year-old in a small Indian town understands on first read."
      : `- Simple, everyday ${brand.language} as people speak it, not formal or literary.`,
    "- Short sentences: at most 12 words. One idea per sentence.",
    "- Common words only. If you must use a technical or exam term, explain it once in a few words.",
    "- Say exactly what the reader gets and what to do next. No vague hype (\"revolutionary\", \"unlock\", \"elevate\", \"game-changer\").",
    "- Indian formats: ₹ for money, lakh and crore (₹1,50,000 not ₹150,000), dates like 23 May 2027, IST for times.",
    "- Indian context: Indian festivals, places, exams and daily life, not American references.",
    "- Never promise results you can't prove (no \"guaranteed\", \"100%\", \"top rank\").",
  ];
}

/** Phrases that make a post sound written by an AI or an ad agency (the checker flags them). */
export const AI_PHRASES = [
  "in today's fast-paced",
  "in today's world",
  "in the world of",
  "look no further",
  "whether you're",
  "whether you are",
  "embark on",
  "dive into",
  "delve into",
  "take your",
  "to the next level",
  "it's not just",
  "it is not just",
  "we're thrilled",
  "we are thrilled",
  "we're excited to",
  "are you ready to",
  "don't miss out",
  "tapestry",
  "testament to",
  "navigate the",
  "harness the power",
  "transformative",
  "ever-evolving",
  "a must-have",
  "unlock the",
  "unlock your",
  "elevate your",
  "seamlessly",
  "journey of",
  "look no more",
];

/** How a real person who runs the business writes (every writer gets these). */
export function humanVoiceRules(): string[] {
  return [
    "HUMAN VOICE (sound like the owner, never like an AI or an ad agency):",
    "- Start with something concrete: a real moment, a question a customer asked, a small detail, a number from the key facts.",
    "- Talk to one person: \"you\" and \"we\". Mix short and medium sentences. Plain words.",
    "- One honest, specific detail beats three big adjectives.",
    `- Never use these phrases: ${AI_PHRASES.slice(0, 18).map((p) => `\"${p}\"`).join(", ")}.`,
    "- No long dashes (—). At most 2 exclamation marks and 3 emojis in a post. Hashtags only at the end.",
    "- If the language mixes (e.g. English + Hindi or Telugu), mix naturally the way people text, in Latin letters unless told otherwise.",
  ];
}

/** The owner's own past posts: the AI copies their voice (words, length, emoji habit), never the text. */
export function voiceSampleLines(brand: Pick<Brand, "voiceSamples">): string[] {
  const s = (brand.voiceSamples ?? "").trim();
  return s ? ["THE OWNER'S OWN POSTS (write in this voice; do not copy them):", s.slice(0, 1500)] : [];
}

/** The brand's approved facts, if any (used by every writer). */
export function brandFactsBlock(brand: Pick<Brand, "keyFacts">): string[] {
  const facts = (brand.keyFacts ?? "").trim();
  return facts ? ["BRAND KEY FACTS (the only facts and numbers about the brand you may state):", facts] : [];
}

const DEFAULT_LOOK = [
  "Set in India with Indian people (South Asian faces, natural skin tones, everyday Indian clothes)",
  "real Indian places and objects (homes, hostels, classrooms, shops, streets, chai, local transport) where they fit",
  "candid editorial photo, natural light, realistic, shot on a 35mm camera, shallow depth of field",
].join(", ");

const NEGATIVE = "no text, no letters, no words, no logos, no watermark, no Western stock-photo look, no plastic 3D render, no distorted hands or faces";

/** Where the template prints text, so the photo leaves that area calm. */
const SPACE_FOR_TEXT: Record<string, string> = {
  band: "main subject in the upper two-thirds, calm lower third",
  top: "main subject in the lower half, calm sky or wall at the top",
  center: "subject around the edges, calm centre",
  split: "single clear subject, centred",
  tip: "single clear subject, centred, uncluttered",
  announcement: "subject centred, simple background",
  bignumber: "simple texture or scene, low detail",
  question: "simple texture or scene, low detail",
  quote: "simple scene, low detail",
};

/**
 * Prompt for the AI photo behind a poster or reel scene.
 * The AI makes only the photo; text and logo are added by our templates.
 */
export function imagePrompt(brand: Pick<Brand, "name" | "description" | "colors" | "visualStyle" | "industry">, subject: string, template?: string): string {
  const look = (brand.visualStyle ?? "").trim();
  return [
    subject.trim() || brand.description || brand.industry || brand.name,
    look ? `Brand look: ${look}` : "",
    DEFAULT_LOOK,
    brand.colors.length ? `subtle colour accents of ${brand.colors.slice(0, 3).join(", ")}` : "",
    template && SPACE_FOR_TEXT[template] ? `Composition: ${SPACE_FOR_TEXT[template]}` : "Composition: leave calm empty space for text",
    NEGATIVE,
  ]
    .filter(Boolean)
    .join(". ");
}

/** "https://www.example.com/path" -> "example.com" for the poster footer. */
export function siteLabel(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
