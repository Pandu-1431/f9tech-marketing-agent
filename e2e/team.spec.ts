import { expect, test } from "@playwright/test";
import { createBrand, createCampaign, PASSWORD, postCard, register, uniqueEmail, waitForCampaignDone } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200) + 20}` });
});

test("owner invites a client reviewer: client can view and approve, but not edit", async ({ page, browser }) => {
  await register(page, { email: uniqueEmail("owner"), business: "Sunrise Agency" });
  await createBrand(page, { name: "Sunrise Hotels", colors: "#B45309" });
  const campaignUrl = await createCampaign(page, { theme: "Weekend stay offers" });
  await waitForCampaignDone(page, campaignUrl);

  // Owner creates a client invite link.
  await page.goto("/settings/team");
  await page.fill("#label", "Ravi from Sunrise");
  await page.getByRole("button", { name: "Create invite link" }).click();
  const link = await page.getByTestId("invite-link").inputValue();
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{20,}$/);
  await expect(page.getByText("Ravi from Sunrise", { exact: true })).toBeVisible();

  // The client opens the link in their own browser and signs up.
  const clientCtx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.250" } });
  const client = await clientCtx.newPage();
  await client.goto(new URL(link).pathname);
  await expect(client.getByRole("heading", { name: "Join Sunrise Agency" })).toBeVisible();
  await expect(client.locator("#business")).toHaveCount(0);
  await client.fill("#name", "Ravi");
  await client.fill("#email", uniqueEmail("client"));
  await client.fill("[name=password]", PASSWORD);
  await client.getByRole("button", { name: "Create account" }).click();
  await client.waitForURL("**/dashboard", { waitUntil: "commit" });
  await expect(client.getByTestId("client-badge")).toBeVisible();
  await expect(client.getByRole("link", { name: "AI connections" })).toHaveCount(0);
  await expect(client.getByRole("link", { name: "Team" })).toHaveCount(0);
  await expect(client.getByRole("link", { name: "New campaign" })).toHaveCount(0);

  // Client sees the campaign: no edit controls, but can approve.
  await client.goto(new URL(campaignUrl).pathname);
  const card = postCard(client, 0);
  await expect(card.getByRole("button", { name: "Save edits" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Rewrite with AI" })).toHaveCount(0);
  await expect(card.locator("input[name=posterHeadline]")).toHaveCount(0);
  await card.getByRole("button", { name: /^Approve v\d+$/ }).click();
  await expect(postCard(client, 0).locator("header")).toContainText("approved");
  await expect(postCard(client, 0).getByTestId("approval-line")).toContainText("by Ravi");

  // Editor-only pages send the client back to the dashboard.
  await client.goto("/settings/ai");
  await client.waitForURL("**/dashboard", { waitUntil: "commit" });
  await client.goto("/settings/team");
  await client.waitForURL("**/dashboard", { waitUntil: "commit" });
  await client.goto("/campaigns/new");
  await client.waitForURL("**/dashboard", { waitUntil: "commit" });

  // The link works only once.
  const third = await (await browser.newContext()).newPage();
  await third.goto(new URL(link).pathname);
  await expect(third.getByRole("heading", { name: "This invite link can't be used" })).toBeVisible();

  // Owner sees the client as a member, and can remove them.
  await page.goto("/settings/team");
  const members = page.getByTestId("members");
  await expect(members).toContainText("Ravi");
  await expect(members).toContainText("Client reviewer");
  await members.locator("li", { hasText: "Ravi" }).getByRole("button", { name: "Remove" }).click();
  await expect(members).not.toContainText("Ravi");
  await clientCtx.close();
});
