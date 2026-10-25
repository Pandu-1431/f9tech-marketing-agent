import { expect, type Page } from "@playwright/test";

export const PASSWORD = "Correct-Horse-42";

let counter = 0;
/** A fresh email per test, so tests never depend on each other. */
export function uniqueEmail(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@e2e.test`;
}

export async function register(page: Page, opts: { email: string; name?: string; business?: string; password?: string }) {
  await page.goto("/register");
  await page.fill("#name", opts.name ?? "Test Owner");
  await page.fill("#business", opts.business ?? "Test Agency");
  await page.fill("#email", opts.email);
  await page.fill("[name=password]", opts.password ?? PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/dashboard", { waitUntil: "commit" });
}

export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("[name=password]", password);
  await page.getByRole("button", { name: "Log in" }).click();
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForURL("**/login", { waitUntil: "commit" });
}

export async function createBrand(page: Page, opts: { name: string; colors?: string }) {
  await page.goto("/brands/new");
  await page.fill("#name", opts.name);
  if (opts.colors) await page.fill("#colors", opts.colors);
  await page.getByRole("button", { name: "Save business account" }).click();
  await page.waitForURL("**/brands", { waitUntil: "commit" });
  await expect(page.getByText(opts.name).first()).toBeVisible();
}

/** Creates a campaign (Instagram, 2 posts a week, default dates) and returns its URL. */
export async function createCampaign(page: Page, opts: { theme: string; brand?: string }) {
  await page.goto("/campaigns/new");
  if (opts.brand) await page.selectOption("#brandId", { label: opts.brand });
  await page.fill("#theme", opts.theme);
  await page.fill("#postsPerWeek", "2");
  await page.getByRole("button", { name: "Plan and write campaign" }).click();
  await page.waitForURL(/\/campaigns\/\d+$/, { waitUntil: "commit" });
  return page.url();
}

/** Reloads the campaign page until the agent has finished writing and designing. */
export async function waitForCampaignDone(page: Page, url: string) {
  await expect(async () => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const main = page.locator("main");
    await expect(main.getByText("ready", { exact: true })).toBeVisible({ timeout: 1000 });
    await expect(main.getByText("The agent is working")).toHaveCount(0, { timeout: 1000 });
  }).toPass({ timeout: 90_000, intervals: [2000] });
}

/** The card (article) of the n-th post on a campaign page. */
export const postCard = (page: Page, n = 0) => page.locator("main article").nth(n);

/** The error message shown inside a form (not Next.js's hidden route announcer). */
export const formAlert = (page: Page) => page.locator("form [role=alert]");
