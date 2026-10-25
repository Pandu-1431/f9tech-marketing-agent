import { expect, test } from "@playwright/test";
import { formAlert, login, logout, PASSWORD, register, uniqueEmail } from "./helpers";

const WRONG = "Wrong email or password";
const LOCKED = /Too many sign-in attempts/;

// Each test pretends to come from its own client IP (the app reads X-Forwarded-For),
// so throttling in one test never affects another.
let ipCounter = 10;
test.beforeEach(async ({ page }) => {
  ipCounter += 1;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${ipCounter}` });
});

test("register, log out and log back in", async ({ page }) => {
  const email = uniqueEmail("owner");
  await register(page, { email, name: "Priya Owner", business: "Priya Digital" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Free plan")).toBeVisible(); // AGENT_TRIAL_DAYS=0: no countdown
  await logout(page);

  await login(page, email, PASSWORD);
  await page.waitForURL("**/dashboard", { waitUntil: "commit" });
  await expect(page.getByText("Priya Owner")).toBeVisible();
});

test("a wrong password and an unknown email get the same message", async ({ page }) => {
  const email = uniqueEmail("known");
  await register(page, { email });
  await logout(page);

  await login(page, email, "not-the-password");
  await expect(formAlert(page)).toHaveText(WRONG);
  await login(page, uniqueEmail("nobody"), "not-the-password");
  await expect(formAlert(page)).toHaveText(WRONG);
});

test("5 failed sign-ins lock that account; other users can still sign in", async ({ page, browser }) => {
  const victim = uniqueEmail("victim");
  await register(page, { email: victim });
  await logout(page);

  for (let i = 1; i <= 4; i++) {
    await login(page, victim, `guess-${i}`);
    await expect(formAlert(page)).toHaveText(WRONG);
  }
  await login(page, victim, "guess-5");
  await expect(formAlert(page)).toHaveText(LOCKED);

  // While locked, even the right password is refused (and nothing reveals it was right).
  await login(page, victim, PASSWORD);
  await expect(formAlert(page)).toHaveText(LOCKED);
  await expect(page).toHaveURL(/\/login/);

  // A different user from a different machine is not affected.
  const other = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.250" } });
  const p2 = await other.newPage();
  const otherEmail = uniqueEmail("other");
  await register(p2, { email: otherEmail });
  await logout(p2);
  await login(p2, otherEmail, PASSWORD);
  await p2.waitForURL("**/dashboard", { waitUntil: "commit" });
  await other.close();
});

test("trying many different emails from one IP is throttled too", async ({ page }) => {
  // 20 failures from this IP, each with a different email (none reaches the per-email limit).
  for (let i = 0; i < 20; i++) {
    await login(page, uniqueEmail(`spray${i}`), "password123");
    await expect(formAlert(page)).toBeVisible();
  }
  await login(page, uniqueEmail("fresh"), "password123");
  await expect(formAlert(page)).toHaveText(LOCKED);
});
