import type { Brand, ReelStyle } from "@/db/schema";

/*
 * Video styles (all free: Cloudflare/Hugging Face images, free voice, ffmpeg).
 *   presenter  one AI face per business talks to camera between scene shots
 *   theme      festival / season look: every scene shares one visual theme
 *   concept    explainer: problem -> idea -> how -> result -> call to action, 3D illustrations
 *   text       big animated words on brand colours, no images (fastest, never runs out)
 *   classic    the original photo slideshow
 */

export const REEL_STYLES: { key: ReelStyle; label: string; emoji: string; hint: string }[] = [
  { key: "presenter", label: "AI presenter", emoji: "🧑‍💼", hint: "Your AI face talks to the viewer between scene shots" },
  { key: "theme", label: "Theme", emoji: "🎉", hint: "Festival or season look on every scene" },
  { key: "concept", label: "Concept", emoji: "💡", hint: "Problem → idea → result, as clean 3D illustrations" },
  { key: "text", label: "Text", emoji: "🔤", hint: "Bold animated words on your brand colours" },
  { key: "classic", label: "Classic", emoji: "🎞️", hint: "Photo slideshow with voice" },
];

/** The four new styles ("Make all styles"). */
export const MULTI_STYLES: ReelStyle[] = ["presenter", "theme", "concept", "text"];

export function isReelStyle(v: unknown): v is ReelStyle {
  return typeof v === "string" && REEL_STYLES.some((s) => s.key === v);
}

export function styleLabel(v: string | null | undefined): string {
  return REEL_STYLES.find((s) => s.key === v)?.label ?? "Classic";
}

/** A sensible default per business segment, when nobody picked a style. */
export function autoStyle(brand: Pick<Brand, "industry">): ReelStyle {
  const i = (brand.industry ?? "").toLowerCase();
  if (/school|college|coach|academy|tuition|course|training|institute|education|clinic|doctor|hospital|dental|consult|lawyer|finance|insurance|real estate|realty/.test(i)) return "presenter";
  if (/software|saas|app|tech|it services|agency|marketing|digital/.test(i)) return "concept";
  if (/sweet|bakery|restaurant|cafe|food|jewel|saree|fashion|boutique|textile|gift|florist|event|wedding|hotel|travel/.test(i)) return "theme";
  return "theme";
}

/** Extra words added to every scene's image prompt, per style. */
export function styleImageSuffix(style: ReelStyle, look?: string): string {
  switch (style) {
    case "concept":
      return "clean modern 3D illustration, soft studio lighting, pastel background, simple shapes, minimal, no text, no letters";
    case "theme":
      return [look, "cinematic, rich festive colours, shallow depth of field"].filter(Boolean).join(", ");
    case "presenter":
      return "cinematic documentary photo, natural light, candid, shallow depth of field";
    default:
      return "";
  }
}

/** Camera moves for a still scene (ffmpeg zoompan, 1.5x oversized source). "on" = output frame number. */
export const MOTIONS: Record<string, { z: string; x: string; y: string }> = {
  zoomIn: { z: "min(1+0.0010*on,1.15)", x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" },
  zoomOut: { z: "max(1.15-0.0010*on,1)", x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" },
  panRight: { z: "1.15", x: "(iw-iw/zoom)*min(on/180,1)", y: "ih/2-(ih/zoom/2)" },
  panLeft: { z: "1.15", x: "(iw-iw/zoom)*(1-min(on/180,1))", y: "ih/2-(ih/zoom/2)" },
  panUp: { z: "1.15", x: "iw/2-(iw/zoom/2)", y: "(ih-ih/zoom)*(1-min(on/180,1))" },
  punchIn: { z: "if(lt(on,24),1+0.006*on,1.144+0.0003*(on-24))", x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" },
  // Presenter "talking": slow push-in with a gentle breathing bob, like a handheld phone camera.
  talk: { z: "1.06+0.0004*on+0.008*sin(on/9)", x: "iw/2-(iw/zoom/2)+6*sin(on/23)", y: "ih/2-(ih/zoom/2)+5*sin(on/17)" },
};

const ORDER: Record<ReelStyle, string[]> = {
  classic: ["zoomIn", "zoomOut"],
  presenter: ["zoomIn", "panRight", "zoomOut", "panLeft"],
  theme: ["panRight", "zoomIn", "panLeft", "zoomOut", "panUp"],
  concept: ["zoomIn", "zoomOut"],
  text: ["zoomIn", "zoomOut"],
};

export function motionFor(style: ReelStyle, sceneIndex: number, kind?: string): { z: string; x: string; y: string } {
  if (kind === "presenter") return MOTIONS.talk;
  // The hook: a quick punch-in in the first second stops the scroll.
  if (sceneIndex === 0) return MOTIONS.punchIn;
  const list = ORDER[style] ?? ORDER.classic;
  return MOTIONS[list[sceneIndex % list.length]];
}

/** ffmpeg xfade transitions between scenes, per style (all exist in ffmpeg 4.3+). */
const TRANSITIONS: Record<ReelStyle, string[]> = {
  classic: ["fade"],
  presenter: ["smoothleft", "fade", "smoothup", "circleopen"],
  theme: ["circleopen", "slideleft", "radial", "smoothup"],
  concept: ["slideleft", "slideleft", "slideup"],
  text: ["slideup", "wipeleft", "slideleft", "fadeblack"],
};

export function transitionFor(style: ReelStyle, i: number): string {
  const list = TRANSITIONS[style] ?? TRANSITIONS.classic;
  return list[i % list.length];
}

/** Script instructions for each style. */
export function styleScriptLines(style: ReelStyle, presenterName?: string): string[] {
  switch (style) {
    case "presenter":
      return [
        "STYLE: PRESENTER. A friendly presenter" + (presenterName ? ` named ${presenterName}` : "") + " talks straight to the camera, like a creator vlog.",
        '- Each scene has "kind": "presenter" (the presenter speaks to camera) or "broll" (a scene photo while the presenter keeps talking).',
        '- Scene 1 and the last scene are "presenter". Alternate: presenter, broll, presenter, broll... (5 or 6 scenes).',
        "- voiceover is the presenter's own words, first person, energetic and warm (\"Hi! Let me show you...\").",
        '- For "presenter" scenes image_prompt can be empty; for "broll" scenes describe the real place or action.',
      ];
    case "theme":
      return [
        "STYLE: THEME. Every scene shares ONE visual theme that fits the campaign (a festival, season or occasion).",
        '- Add "look": one line describing that shared look (colours, lights, decorations, props), e.g. "Diwali night, warm diyas, marigold garlands, gold and maroon".',
        '- Every scene is "kind": "broll". image_prompt describes the scene inside that look.',
      ];
    case "concept":
      return [
        "STYLE: CONCEPT. Explain one idea simply, in steps: the problem, the idea, how it works, the result, the call to action.",
        '- 5 scenes, each "kind": "broll" with "step": a 1-3 word label ("The problem", "The idea", "How it works", "The result", "Start today").',
        "- image_prompt: a simple 3D illustration of the step (objects, icons, a character), no text in the image.",
      ];
    case "text":
      return [
        "STYLE: TEXT. A typography video: no photos, only big bold words on brand colours.",
        '- 5 or 6 scenes, every one "kind": "text". on_screen carries the message: max 5 punchy words. image_prompt empty.',
        "- Build tension: a hook, two or three short facts, a payoff, the call to action.",
      ];
    default:
      return ['- Every scene is "kind": "broll".'];
  }
}
