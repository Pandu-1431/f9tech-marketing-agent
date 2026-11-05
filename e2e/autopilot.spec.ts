import { expect, test } from "@playwright/test";
import { createBrand, register, uniqueEmail } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200) + 20}` });
});

test("weekly autopilot: turn it on, plan this week now, the week's campaign appears", async ({ page }) => {
  await register(page, { email: uniqueEmail("auto") });
  await createBrand(page, { name: "Autopilot Academy", colors: "#3730A3, #F59E0B" });
  await page.getByText("Autopilot Academy").first().click();
  await page.waitForURL("**/brands/*", { waitUntil: "commit" });

  // YouTube box: without Google keys it explains what is needed; the connect route says so too.
  await expect(page.getByTestId("youtube-connect")).toContainText("GOOGLE_CLIENT_ID");
  const brandUrl = page.url();
  await page.goto(`/api/oauth/google/start?brandId=${brandUrl.split("/").pop()}`);
  await expect(page.getByTestId("youtube-connect")).toContainText("Add GOOGLE_CLIENT_ID");
  await page.goto(brandUrl);

  const box = page.getByTestId("autopilot");
  await box.getByLabel("Turn on weekly autopilot").check();
  await box.getByRole("button", { name: "Save autopilot" }).click();
  await expect(box.getByText(/On · next week is planned/)).toBeVisible();

  await box.getByRole("button", { name: "Plan this week now" }).click();
  await page.goto("/dashboard");
  await expect(page.getByTestId("autopilot-card")).toContainText("Autopilot Academy");

  // The autopilot campaign shows up under Campaigns with its badge.
  await expect(async () => {
    await page.goto("/campaigns");
    await expect(page.getByText("Autopilot", { exact: true }).first()).toBeVisible();
  }).toPass({ timeout: 60_000 });
});
