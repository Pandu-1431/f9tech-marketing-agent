import { describe, expect, it } from "vitest";
import { checkPost } from "@/agent/quality";
import { brandSystemPrompt } from "@/agent/brand-context";
import { humanVoiceRules, voiceSampleLines } from "@/agent/style";
import type { Brand, Campaign, Post } from "@/db/schema";

const brand = { id: 1, name: "Sweet Shop", language: "English", colors: [], fonts: [], keywords: [], hashtags: [], platforms: ["instagram"], logoKey: "x", keyFacts: "Fresh daily", voiceSamples: "Kaju katli is back! Fresh batch at 4 pm today. Come early 🙂" } as unknown as Brand;
const campaign = { callToAction: null, theme: "Diwali" } as unknown as Campaign;
const post = (caption: string) => ({ id: 7, platform: "instagram", format: "text", caption, hashtags: ["#a", "#b", "#c", "#d", "#e"], demoParts: [], posterHeadline: null, status: "drafted" }) as unknown as Post;

describe("human voice", () => {
  it("every writer gets the human-voice rules and the owner's own posts", () => {
    const p = brandSystemPrompt(brand);
    expect(p).toContain("HUMAN VOICE");
    expect(p).toContain("THE OWNER'S OWN POSTS");
    expect(p).toContain("Kaju katli is back!");
    expect(humanVoiceRules().join("\n")).toMatch(/No long dashes/);
    expect(voiceSampleLines({ voiceSamples: "" })).toEqual([]);
  });

  it("flags AI-sounding phrases and machine-made style, for an automatic rewrite", () => {
    const ai = checkPost({ post: post("In today's fast-paced world, look no further! Elevate your Diwali — unlock the joy — with us!!! 🎉🎉🎉🎉🎉"), brand, campaign });
    const codes = ai.map((i) => i.code);
    expect(codes).toContain("ai_phrases");
    expect(codes).toContain("ai_style");
    expect(ai.find((i) => i.code === "ai_phrases")).toMatchObject({ level: "warn", fix: "rewrite" });

    const human = checkPost({ post: post("Kaju katli is back. Fresh batch at 4 pm today, so come early 🙂"), brand, campaign });
    expect(human.map((i) => i.code)).not.toContain("ai_phrases");
    expect(human.map((i) => i.code)).not.toContain("ai_style");
  });
});
