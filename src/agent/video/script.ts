import { z } from "zod";
import type { Brand, Campaign, Post, ReelScene, ReelScript, ReelStyle } from "@/db/schema";
import { styleScriptLines } from "./styles";
import { brandSystemPromptWithMemory } from "../brand-context";
import { parseJsonObject } from "../json";
import { generateText } from "../router";
import { campaignBriefLines } from "../planner";

const schema = z.object({
  title: z.string().default(""),
  scenes: z
    .array(
      z.object({
        voiceover: z.string().min(1),
        on_screen: z.string().default(""),
        image_prompt: z.string().default(""),
        shot: z.coerce.number().int().optional().nullable(),
        kind: z.string().optional().nullable(),
        step: z.string().optional().nullable(),
      }),
    )
    .min(2)
    .max(8),
  cta: z.string().default(""),
  look: z.string().optional().nullable(),
});

export function reelPrompt(campaign: Campaign, post: Post, shots: string[] = [], style: ReelStyle = "classic", presenterName?: string): string {
  return [
    "TASK: REEL_SCRIPT",
    `CAMPAIGN THEME: ${campaign.theme}`,
    `CAMPAIGN GOAL: ${campaign.goal ?? "grow reach and enquiries"}`,
    `PLATFORM: ${post.platform}`,
    `POST ANGLE: ${post.angle ?? ""}`,
    `POST CAPTION: ${post.caption ?? ""}`,
    ...campaignBriefLines(campaign),
    "",
    "Write a vertical short-video script (Instagram Reel / YouTube Short / Facebook Reel) of 20-35 seconds.",
    "- 4 to 6 scenes. Scene 1 is a hook that stops the scroll in the first 2 seconds.",
    "- The last scene is the call to action.",
    "- voiceover: what the narrator says, max 16 words per scene. Talk like a friendly Indian mentor speaking to one person: simple, warm, clear. Easy to follow by ear.",
    "- Scene 1 hook: a question or surprising fact the viewer cares about (e.g. \"Only 199 days to Prelims. Is your plan ready?\").",
    "- on_screen: big text shown on screen, max 6 words, the key point of the scene.",
    "- image_prompt: one realistic vertical photo for the scene, set in India with Indian people and places where people appear (subject, setting, mood). No text in the image.",
    "- Only use facts from the brand key facts and the campaign brief.",
    "",
    ...styleScriptLines(style, presenterName),
    ...(shots.length
      ? [
          "",
          "PRODUCT SHOTS (real screenshots of the product; showing the real product builds trust):",
          ...shots.map((label, i) => `${i + 1}. ${label}`),
          '- In 1 or 2 scenes that talk about the product, set "shot" to the number of the best matching screenshot; it is shown in a phone instead of a photo. Other scenes: leave "shot" out.',
        ]
      : []),
    "- cta: 2-4 word button text for the last scene (e.g. \"Order on WhatsApp\").",
    'Reply with JSON only: {"title": "...", "look": "...", "scenes": [{"kind": "broll", "step": "", "voiceover": "...", "on_screen": "...", "image_prompt": "...", "shot": null}], "cta": "..."}',
  ].join("\n");
}

/** Post -> reel script (scenes with voiceover, on-screen text and image prompts). */
export async function writeReelScript(campaign: Campaign, brand: Brand, post: Post, shots: string[] = [], style: ReelStyle = "classic"): Promise<ReelScript> {
  return (await writeReelScriptWithProvider(campaign, brand, post, shots, style)).script;
}

const KINDS = ["presenter", "broll", "text"] as const;

/** The model's scene kind, made consistent with the style (a text video has only text scenes, etc.). */
export function sceneKind(style: ReelStyle, raw: string | null | undefined, i: number, count: number): NonNullable<ReelScene["kind"]> {
  if (style === "text") return "text";
  if (style === "presenter") {
    if (i === 0 || i === count - 1) return "presenter";
    const k = (KINDS as readonly string[]).includes(raw ?? "") ? (raw as NonNullable<ReelScene["kind"]>) : null;
    return k === "presenter" || k === "broll" ? k : i % 2 === 0 ? "presenter" : "broll";
  }
  return "broll";
}

/** Same as writeReelScript, plus which text provider wrote it (to label demo output). */
export async function writeReelScriptWithProvider(
  campaign: Campaign,
  brand: Brand,
  post: Post,
  shots: string[] = [],
  style: ReelStyle = "classic",
): Promise<{ script: ReelScript; provider: string }> {
  const out = await generateText(
    { workspaceId: post.workspaceId, brandId: brand.id, purpose: "reel_script", subject: { type: "post", id: post.id } },
    { system: await brandSystemPromptWithMemory(brand), prompt: reelPrompt(campaign, post, shots, style, brand.presenter?.name), json: true, temperature: 0.8 },
  );
  const s = schema.parse(parseJsonObject(out.text));
  const script: ReelScript = {
    title: s.title || campaign.theme,
    scenes: s.scenes.slice(0, 6).map((sc, i, all) => {
      const kind = sceneKind(style, sc.kind, i, all.length);
      return {
        voiceover: sc.voiceover.trim(),
        onScreen: (sc.on_screen.trim() || (kind === "text" ? sc.voiceover.trim().split(/\s+/).slice(0, 5).join(" ") : "")).slice(0, 60),
        imagePrompt: sc.image_prompt.trim(),
        kind,
        ...(style === "concept" && sc.step?.trim() ? { step: sc.step.trim().slice(0, 24) } : {}),
        ...(kind === "broll" && sc.shot && sc.shot >= 1 && sc.shot <= shots.length ? { shot: sc.shot } : {}),
      };
    }),
    cta: (s.cta || post.posterCta || "Order now").slice(0, 40),
    style,
    ...(style === "theme" && s.look?.trim() ? { look: s.look.trim().slice(0, 200) } : {}),
  };
  return { script, provider: out.provider };
}
