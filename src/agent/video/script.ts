import { z } from "zod";
import type { Brand, Campaign, Post, ReelScript } from "@/db/schema";
import { brandSystemPrompt } from "../brand-context";
import { parseJsonObject } from "../json";
import { generateText } from "../router";

const schema = z.object({
  title: z.string().default(""),
  scenes: z
    .array(
      z.object({
        voiceover: z.string().min(1),
        on_screen: z.string().default(""),
        image_prompt: z.string().default(""),
      }),
    )
    .min(2)
    .max(8),
  cta: z.string().default(""),
});

export function reelPrompt(campaign: Campaign, post: Post): string {
  return [
    "TASK: REEL_SCRIPT",
    `CAMPAIGN THEME: ${campaign.theme}`,
    `CAMPAIGN GOAL: ${campaign.goal ?? "grow reach and enquiries"}`,
    `PLATFORM: ${post.platform}`,
    `POST ANGLE: ${post.angle ?? ""}`,
    `POST CAPTION: ${post.caption ?? ""}`,
    "",
    "Write a vertical short-video script (Instagram Reel / YouTube Short / Facebook Reel) of 20-35 seconds.",
    "- 4 to 6 scenes. Scene 1 is a hook that stops the scroll in the first 2 seconds.",
    "- The last scene is the call to action.",
    "- voiceover: what the narrator says, max 18 words per scene, simple spoken English.",
    "- on_screen: big text shown on screen, max 6 words.",
    "- image_prompt: one vertical photo for the scene (subject, setting, brand colours, mood). No text in the image.",
    "- cta: 2-4 word button text for the last scene (e.g. \"Order on WhatsApp\").",
    'Reply with JSON only: {"title": "...", "scenes": [{"voiceover": "...", "on_screen": "...", "image_prompt": "..."}], "cta": "..."}',
  ].join("\n");
}

/** Post -> reel script (scenes with voiceover, on-screen text and image prompts). */
export async function writeReelScript(campaign: Campaign, brand: Brand, post: Post): Promise<ReelScript> {
  const out = await generateText(
    { workspaceId: post.workspaceId, brandId: brand.id, purpose: "reel_script", subject: { type: "post", id: post.id } },
    { system: brandSystemPrompt(brand), prompt: reelPrompt(campaign, post), json: true, temperature: 0.8 },
  );
  const s = schema.parse(parseJsonObject(out.text));
  return {
    title: s.title || campaign.theme,
    scenes: s.scenes.slice(0, 6).map((sc) => ({
      voiceover: sc.voiceover.trim(),
      onScreen: sc.on_screen.trim().slice(0, 60),
      imagePrompt: sc.image_prompt.trim(),
    })),
    cta: (s.cta || post.posterCta || "Order now").slice(0, 40),
  };
}
