import { beforeEach, describe, expect, it } from "vitest";
import { createBrand, getBrand, listBrands, updateBrand, deleteBrand, createCampaign, LimitError } from "@/lib/data";
import { freshDb, makeWorkspace } from "./helpers";

describe("multi-tenant isolation and free limits", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("never shows one workspace's brands to another", async () => {
    const a = await makeWorkspace("Alpha");
    const b = await makeWorkspace("Beta");
    const brandA = await createBrand(a.ws.id, { name: "Alpha Sweets" });

    expect(await listBrands(b.ws.id)).toHaveLength(0);
    expect(await getBrand(b.ws.id, brandA.id)).toBeNull();
    expect(await updateBrand(b.ws.id, brandA.id, { name: "Hacked" })).toBeNull();
    await deleteBrand(b.ws.id, brandA.id);
    expect((await getBrand(a.ws.id, brandA.id))?.name).toBe("Alpha Sweets");
  });

  it("cannot start a campaign for another workspace's brand", async () => {
    const a = await makeWorkspace("Alpha");
    const b = await makeWorkspace("Beta");
    const brandA = await createBrand(a.ws.id, { name: "Alpha Sweets" });
    await expect(
      createCampaign(b.ws.id, {
        brandId: brandA.id,
        theme: "Diwali",
        platforms: ["instagram"],
        startDate: "2026-11-01",
        endDate: "2026-11-07",
        postsPerWeek: 3,
      }),
    ).rejects.toBeInstanceOf(LimitError);
  });

  it("allows 4 business accounts on the free plan, not 5", async () => {
    const a = await makeWorkspace("Alpha");
    for (let i = 1; i <= 4; i++) await createBrand(a.ws.id, { name: `Brand ${i}` });
    await expect(createBrand(a.ws.id, { name: "Brand 5" })).rejects.toBeInstanceOf(LimitError);
  });
});
