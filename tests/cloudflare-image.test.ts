import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareImageProvider } from "@/agent/images/providers";

describe("Cloudflare FLUX image provider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends only prompt and steps (FLUX schnell refuses extra fields like seed)", async () => {
    const png = Buffer.from("fake-image").toString("base64");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, result: { image: png } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const p = new CloudflareImageProvider({ name: "cloudflare", model: "@cf/black-forest-labs/flux-1-schnell", apiKey: "t", accountId: "a" } as never);
    const out = await p.generate({ prompt: "chai on a table", width: 1080, height: 1080, seed: 42 } as never);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/accounts/a/ai/run/@cf/black-forest-labs/flux-1-schnell");
    expect(Object.keys(JSON.parse(String(init.body))).sort()).toEqual(["prompt", "steps"]);
    expect(out.data.toString()).toBe("fake-image");
  });
});
