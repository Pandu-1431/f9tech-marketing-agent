import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bestPexelsFile, findStockVideo, orientationOf, pick, StockImageProvider, stockQuery } from "@/agent/images/stock";

const jpeg = () => sharp({ create: { width: 1200, height: 1600, channels: 3, background: "#336699" } }).jpeg().toBuffer();
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("real photos: search words", () => {
  it("keeps the main words of the first sentence, drops style words", () => {
    expect(stockQuery("A young Indian woman studying late at night at a desk with books, warm lamp light, photo")).toBe("young indian woman studying late night");
    expect(stockQuery("Photorealistic close up of masala chai. Soft light")).toBe("masala chai");
    expect(stockQuery("")).toBe("");
  });

  it("knows the frame shape", () => {
    expect(orientationOf(1080, 1920)).toBe("portrait");
    expect(orientationOf(1200, 628)).toBe("landscape");
    expect(orientationOf(1080, 1080)).toBe("square");
  });

  it("never picks a photo the business already used", () => {
    const hits = [{ sourceId: "pexels:1" }, { sourceId: "pexels:2" }, { sourceId: "pexels:3" }];
    expect(pick(hits, 0, ["pexels:1"])?.sourceId).toBe("pexels:2");
    expect(pick(hits, 0, ["pexels:1", "pexels:2", "pexels:3"])).toBeNull();
  });

  it("picks an HD video file, not 4K and not a tiny one", () => {
    const f = bestPexelsFile([
      { quality: "uhd", file_type: "video/mp4", width: 2160, height: 3840, link: "4k" },
      { quality: "sd", file_type: "video/mp4", width: 360, height: 640, link: "tiny" },
      { quality: "hd", file_type: "video/mp4", width: 1080, height: 1920, link: "hd" },
    ]);
    expect(f?.link).toBe("hd");
  });
});

describe("real photos: providers", () => {
  const env = { ...process.env };
  beforeEach(() => {
    delete process.env.PEXELS_API_KEY;
    delete process.env.PIXABAY_API_KEY;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...env };
  });

  it("without a key it steps aside (the router moves on to the image AIs)", async () => {
    await expect(new StockImageProvider().generate({ prompt: "chai", width: 100, height: 100 })).rejects.toThrow(/no Pexels or Pixabay key/);
  });

  it("finds a Pexels photo, crops it to the poster size and returns the credit", async () => {
    process.env.PEXELS_API_KEY = "k";
    const img = await jpeg();
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(url);
        if (url.startsWith("https://api.pexels.com/v1/search")) {
          expect((init?.headers as Record<string, string>).authorization).toBe("k");
          return json({ photos: [{ id: 7, url: "https://pexels.com/photo/7", width: 1200, height: 1600, photographer: "Ravi K", src: { original: "https://images.pexels.com/7.jpg" } }] });
        }
        return new Response(img, { status: 200, headers: { "content-type": "image/jpeg" } });
      }),
    );
    const out = await new StockImageProvider().generate({ prompt: "A student studying at a desk, warm light", width: 1080, height: 1350, seed: 3 });
    expect(calls[0]).toContain("query=student%20studying%20desk");
    expect(calls[0]).toContain("orientation=portrait");
    expect(out).toMatchObject({ source: "pexels", sourceId: "pexels:7", credit: "Photo: Ravi K on Pexels", mime: "image/jpeg" });
    const meta = await sharp(out.data).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1350]);
  });

  it("falls back to Pixabay and skips photos already used", async () => {
    process.env.PEXELS_API_KEY = "k";
    process.env.PIXABAY_API_KEY = "p";
    const img = await jpeg();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("https://api.pexels.com")) return json({ photos: [] });
        if (url.startsWith("https://pixabay.com/api/"))
          return json({
            hits: [
              { id: 1, pageURL: "p1", largeImageURL: "https://cdn.pixabay.com/1.jpg", imageWidth: 1200, imageHeight: 1600, user: "anu" },
              { id: 2, pageURL: "p2", largeImageURL: "https://cdn.pixabay.com/2.jpg", imageWidth: 1200, imageHeight: 1600, user: "sai" },
            ],
          });
        return new Response(img, { status: 200 });
      }),
    );
    const out = await new StockImageProvider().generate({ prompt: "farmer", width: 1080, height: 1080, avoid: ["pixabay:1"] });
    expect(out.sourceId).toBe("pixabay:2");
    expect(out.credit).toBe("Photo: sai on Pixabay");
  });

  it("video clips: only ones long enough for the scene", async () => {
    process.env.PEXELS_API_KEY = "k";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("https://api.pexels.com/videos/search"))
          return json({
            videos: [
              { id: 1, url: "v1", duration: 2, user: { name: "short" }, video_files: [{ quality: "hd", file_type: "video/mp4", width: 1080, height: 1920, link: "https://videos.pexels.com/1.mp4" }] },
              { id: 2, url: "v2", duration: 12, user: { name: "Meena" }, video_files: [{ quality: "hd", file_type: "video/mp4", width: 1080, height: 1920, link: "https://videos.pexels.com/2.mp4" }] },
            ],
          });
        return new Response(Buffer.from("mp4-bytes"), { status: 200 });
      }),
    );
    const clip = await findStockVideo("city traffic", { width: 1080, height: 1920, minSec: 5 });
    expect(clip).toMatchObject({ sourceId: "pexels-video:2", credit: "Video: Meena on Pexels" });
    expect(clip?.data.toString()).toBe("mp4-bytes");
  });
});
