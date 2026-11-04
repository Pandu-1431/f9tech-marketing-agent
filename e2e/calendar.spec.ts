import { expect, test } from "@playwright/test";
import { createBrand, createCampaign, register, uniqueEmail, waitForCampaignDone } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200) + 20}` });
});

test("calendar: drag a post to another day and change its time; both persist after reload", async ({ page }) => {
  await register(page, { email: uniqueEmail("cal") });
  await createBrand(page, { name: "Calendar Co", colors: "#7C3AED" });
  const url = await createCampaign(page, { theme: "Winter sale" });
  await waitForCampaignDone(page, url);

  // Find the month of the first post from its card's date field.
  const firstDate = await page.locator("main article").first().locator("input[name=date]").inputValue();
  const month = firstDate.slice(0, 7);
  await page.goto(`/calendar?month=${month}`);
  const chip = page.locator("[data-testid^=cal-post-]").first();
  await expect(chip).toBeVisible();
  const chipId = (await chip.getAttribute("data-testid"))!;
  const fromDay = await chip.locator("xpath=..").getAttribute("data-day");

  // Pick another day in the same month that is not the current one.
  const days = await page.locator(`[data-day^="${month}"]`).evaluateAll((els) => els.map((e) => e.getAttribute("data-day")!));
  const target = days.find((d) => d !== fromDay && d.endsWith("15")) ?? days.find((d) => d !== fromDay)!;
  await chip.dragTo(page.getByTestId(`day-${target}`));
  await expect(page.getByTestId(`day-${target}`).getByTestId(chipId)).toBeVisible();
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByTestId(`day-${target}`).getByTestId(chipId)).toBeVisible();

  // Change the time from the panel.
  await page.getByTestId(chipId).click();
  const panel = page.getByTestId("cal-panel");
  await panel.locator("#cal-time").fill("08:45");
  await panel.getByRole("button", { name: "Move" }).click();
  await expect(page.getByTestId(chipId)).toContainText("08:45");
  await page.reload();
  await expect(page.getByTestId(`day-${target}`).getByTestId(chipId)).toContainText("08:45");
});
