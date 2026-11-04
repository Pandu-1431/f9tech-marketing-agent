import { describe, expect, it } from "vitest";
import { capHashtags, creativeSpec, HASHTAG_RULES } from "@/lib/formats";
import { brandFonts, casedFor, fontStack } from "@/lib/font-choices";
import { platformRule } from "@/agent/copywriter";
import { posterSize } from "@/agent/images/poster";

describe("creative standards", () => {
  it("uses 4:5 portrait for feeds, 9:16 for reels and stories, 16:9 for X and YouTube", () => {
    expect(creativeSpec("instagram", "image")).toMatchObject({ width: 1080, height: 1350, ratio: "4:5" });
    expect(creativeSpec("facebook", "carousel")).toMatchObject({ width: 1080, height: 1350 });
    expect(creativeSpec("linkedin", "image")).toMatchObject({ width: 1080, height: 1350 });
    expect(creativeSpec("instagram", "reel")).toMatchObject({ width: 1080, height: 1920, ratio: "9:16" });
    expect(creativeSpec("instagram", "story").safe.bottom).toBeGreaterThan(0);
    expect(creativeSpec("x", "image")).toMatchObject({ width: 1600, height: 900 });
    expect(creativeSpec("youtube", "image")).toMatchObject({ width: 1280, height: 720 });
    expect(posterSize("google_business", "image")).toEqual({ width: 1200, height: 900 });
  });

  it("caps hashtags per platform and keeps the first (campaign) tags", () => {
    const tags = ["#Chakrayuh", "planner", "#a", "#b", "#c", "#d", "#e", "#Chakrayuh"];
    expect(capHashtags("instagram", tags)).toEqual(["#Chakrayuh", "#planner", "#a", "#b", "#c"]);
    expect(capHashtags("x", tags)).toHaveLength(2);
    expect(capHashtags("google_business", tags)).toEqual([]);
    expect(capHashtags("youtube", ["#a", "#b"], "reel")).toContain("#Shorts");
    expect(HASHTAG_RULES.instagram.max).toBe(5);
  });

  it("tells the copywriter the platform's hashtag and length rules", () => {
    expect(platformRule("instagram")).toContain("Hashtags: 3-5");
    expect(platformRule("google_business")).toContain("No hashtags");
    expect(platformRule("x")).toContain("260");
  });

  it("brand fonts fall back to bundled defaults; Telugu and Hindi get script fonts", () => {
    expect(brandFonts(["Montserrat", "Inter"])).toEqual({ heading: "Montserrat", body: "Inter" });
    expect(brandFonts(["Comic Sans", "Lato"])).toEqual({ heading: "Poppins", body: "Inter" });
    expect(brandFonts([])).toEqual({ heading: "Poppins", body: "Inter" });
    expect(fontStack("Poppins", "చక్రయుహ్")).toMatch(/^Poppins, 'Noto Sans Telugu'/);
    expect(fontStack("Inter", "नमस्ते")).toMatch(/^Inter, 'Noto Sans Devanagari'/);
    expect(casedFor("Bebas Neue", "Plan your day")).toBe("PLAN YOUR DAY");
    expect(casedFor("Poppins", "Plan your day")).toBe("Plan your day");
  });
});
