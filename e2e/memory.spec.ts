import { expect, test } from "@playwright/test";
import { createBrand, register, uniqueEmail } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200) + 20}` });
});

test("brand memory: a note can be added, is listed, and can be forgotten; the Analyst is on the team", async ({ page }) => {
  await register(page, { email: uniqueEmail("memory") });
  await createBrand(page, { name: "Memory Academy", colors: "#3730A3" });
  await page.getByText("Memory Academy").first().click();
  await page.waitForURL("**/brands/*", { waitUntil: "commit" });

  const box = page.getByTestId("brand-memory");
  await expect(box).toContainText("Nothing learned yet");
  await box.getByPlaceholder(/Add a note/).fill("Students revise at night; evening posts work.");
  await box.getByRole("button", { name: "Add note" }).click();
  await expect(box).toContainText("Students revise at night; evening posts work.");
  await expect(box).toContainText("Team note");

  await box.getByRole("button", { name: "Read results now" }).click();
  await expect(box.getByText(/Last read: (just now|not yet)/)).toBeVisible();

  await box.getByRole("button", { name: "Forget" }).click();
  await expect(box).toContainText("Nothing learned yet");

  await page.goto("/dashboard");
  await expect(page.getByTestId("ai-team")).toContainText("Analyst");
});
