// Main user journeys still work in a real browser (Stage 9).
import { expect, test } from "@playwright/test";
import { loadFeed, mockApis } from "./fixtures";

test("load a feed, save an article, read it, and open the radar", async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await loadFeed(page);
  await expect(page.locator("#main > div").first().getByRole("article", { name: "Why feeds still matter" })).toBeVisible();

  const card = page.locator("#main > div").first().getByRole("article", { name: "Why feeds still matter" });
  await card.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByRole("heading", { name: /Saved on this device \(1\)/ })).toBeVisible();

  await card.getByRole("button", { name: /^Read/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("The weak spot has always been discovery", { exact: false })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.getByRole("link", { name: "Knowledge Radar" }).click();
  await expect(page.getByRole("heading", { name: "Personal Knowledge Radar" })).toBeVisible();
  await expect(page.getByLabel("Privacy: 2 articles (category)").or(page.getByLabel("Privacy: 1 article (category)"))).toBeVisible();
});

test("unknown pages show a helpful 404 with a way back", async ({ page }) => {
  const response = await page.goto("/this-page-does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.getByRole("link", { name: "Back to the reader" }).click();
  await expect(page.getByLabel("RSS or Atom feed URL")).toBeVisible();
});
