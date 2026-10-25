import { expect, test } from "@playwright/test";
import { createBrand, createCampaign, register, uniqueEmail } from "./helpers";

test("one workspace cannot see or open another workspace's brands or campaigns", async ({ browser }) => {
  const a = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "192.0.2.31" } });
  const pageA = await a.newPage();
  await register(pageA, { email: uniqueEmail("tenant-a"), business: "Agency A" });
  await createBrand(pageA, { name: "Alpha Secret Brand" });
  const brandHref = await pageA.getByRole("link", { name: /Alpha Secret Brand/ }).getAttribute("href");
  expect(brandHref).toMatch(/^\/brands\/\d+$/);
  const campaignUrl = await createCampaign(pageA, { theme: "Alpha confidential launch" });
  const campaignPath = new URL(campaignUrl).pathname;

  const b = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "192.0.2.32" } });
  const pageB = await b.newPage();
  await register(pageB, { email: uniqueEmail("tenant-b"), business: "Agency B" });

  // Lists show nothing from A.
  await pageB.goto("/brands");
  await expect(pageB.getByText("Alpha Secret Brand")).toHaveCount(0);
  await pageB.goto("/campaigns");
  await expect(pageB.getByText("Alpha confidential launch")).toHaveCount(0);

  // Direct links to A's records are "not found" for B.
  const r1 = await pageB.goto(campaignPath);
  expect(r1?.status()).toBe(404);
  await expect(pageB.getByText("Alpha confidential launch")).toHaveCount(0);
  const r2 = await pageB.goto(brandHref!);
  expect(r2?.status()).toBe(404);
  await expect(pageB.getByText("Alpha Secret Brand")).toHaveCount(0);

  // Logged-out visitors are sent to the login page.
  const anon = await browser.newContext();
  const pageAnon = await anon.newPage();
  await pageAnon.goto(campaignPath);
  await expect(pageAnon).toHaveURL(/\/login/);

  await Promise.all([a.close(), b.close(), anon.close()]);
});
