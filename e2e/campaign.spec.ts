import { expect, test } from "@playwright/test";
import { createBrand, createCampaign, postCard, register, uniqueEmail, waitForCampaignDone } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200) + 20}` });
});

test("brand → campaign → posters; approve one post and reject another with a note", async ({ page }) => {
  await register(page, { email: uniqueEmail("agency") });
  await createBrand(page, { name: "Acme Cloud Services", colors: "#1D4ED8, #F59E0B" });
  const url = await createCampaign(page, { theme: "Cloud migration for growing IT teams" });
  await waitForCampaignDone(page, url);

  // Content came from the (stand-in) real AI provider: no demo labels anywhere.
  await expect(page.getByTestId("demo-badge")).toHaveCount(0);
  await expect(page.getByTestId("demo-stamp")).toHaveCount(0);
  const cards = page.locator("main article");
  expect(await cards.count()).toBeGreaterThanOrEqual(2);
  await expect(postCard(page, 0).locator("img").first()).toBeVisible();
  await expect(postCard(page, 0).locator("textarea[name=caption]")).not.toHaveValue("");

  // Reel generation still works: script → scene images → (silent) voice → MP4.
  await postCard(page, 0).getByRole("button", { name: /Make reel video|Remake video/ }).click();
  await expect(async () => {
    await page.reload();
    await expect(postCard(page, 0).locator("video")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 90_000, intervals: [3000] });
  await expect(postCard(page, 0).getByTestId("demo-stamp")).toHaveCount(0);

  // Approve the first post.
  await postCard(page, 0).getByRole("button", { name: "Approve" }).click();
  await expect(postCard(page, 0).locator("header")).toContainText("approved");

  // Reject the second post with a note.
  await postCard(page, 1).locator("input[name=note]").fill("Too salesy, make it friendlier");
  await postCard(page, 1).getByRole("button", { name: "Reject" }).click();
  await expect(postCard(page, 1).locator("header")).toContainText("rejected");
  await page.reload();
  await expect(postCard(page, 1).locator("input[name=note]")).toHaveValue("Too salesy, make it friendlier");
  await expect(postCard(page, 0).locator("header")).toContainText("approved");
});

test("demo output is clearly labelled and cannot be approved", async ({ page }) => {
  await register(page, { email: uniqueEmail("demo") });
  // The stand-in AI fails for this brand, so the app falls back to the built-in demo generator.
  await createBrand(page, { name: "DemoFallback Bakery", colors: "#0de403" });
  const url = await createCampaign(page, { theme: "Weekend cake offer" });
  await waitForCampaignDone(page, url);

  const card = postCard(page, 0);
  await expect(card.getByTestId("demo-badge")).toHaveText(/demo content/i);
  await expect(card.getByTestId("demo-notice")).toContainText("not made by a real AI model");
  await expect(card.getByTestId("demo-stamp")).toBeVisible();
  const approve = card.getByRole("button", { name: "Approve" });
  await expect(approve).toBeDisabled();

  // Server-side guard: even a forced click (button re-enabled in the page) does not approve.
  await approve.evaluate((b) => b.removeAttribute("disabled"));
  await approve.click();
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(postCard(page, 0).locator("header")).not.toContainText("approved");

  // A person editing the caption clears the "text" part, but the demo poster still blocks approval.
  await postCard(page, 0).locator("textarea[name=caption]").fill("Fresh cakes every weekend. Order by Friday!");
  await postCard(page, 0).getByRole("button", { name: "Save edits" }).click();
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(postCard(page, 0).getByTestId("demo-notice")).toContainText("The poster image");
  await expect(postCard(page, 0).getByTestId("demo-notice")).not.toContainText("The caption");
  await expect(postCard(page, 0).getByRole("button", { name: "Approve" })).toBeDisabled();

  // Rejecting demo content is still allowed.
  await postCard(page, 0).getByRole("button", { name: "Reject" }).click();
  await expect(postCard(page, 0).locator("header")).toContainText("rejected");

  // The asset library labels demo images too.
  await page.goto("/library");
  await expect(page.getByTestId("demo-stamp").first()).toBeVisible();
});
