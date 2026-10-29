// Offline reliability (Stage 9): after one online visit, the app opens and
// reloads with no network, showing the offline copy and saved articles.
import { expect, test } from "@playwright/test";
import { loadFeed, mockApis } from "./fixtures";

test("the app opens offline after one online visit (service worker)", async ({ page, context }) => {
  await mockApis(page);
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready; // installed and active
  });
  await page.reload(); // now controlled by the service worker, so build files get cached
  await loadFeed(page);
  await page.locator("#main > div").first().getByRole("article", { name: "Why feeds still matter" }).getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByRole("heading", { name: /Saved on this device \(1\)/ })).toBeVisible();
  await page.goto("/radar"); // visit once so it is cached too
  await expect(page.getByRole("heading", { name: "Personal Knowledge Radar" })).toBeVisible();

  await context.setOffline(true);
  await page.goto("/");
  await expect(page.getByText("Offline: stored articles only")).toBeVisible();
  await expect(page.getByText(/You are offline\. Showing your offline copy/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "The Small Web Journal" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Saved on this device \(1\)/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "The Small Web Journal" })).toBeVisible();

  await page.goto("/radar");
  await expect(page.getByRole("heading", { name: "Personal Knowledge Radar" })).toBeVisible();
  await expect(page.getByLabel(/The Small Web Journal: 1 article/)).toBeVisible();
  await context.setOffline(false);
});

test("API responses are never cached by the service worker", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(async () => {
    await fetch(`/api/feed?url=${encodeURIComponent("http://localhost/x")}`);
  });
  const cachedUrls = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    return urls;
  });
  expect(cachedUrls.some((url) => url.includes("/api/"))).toBe(false);
  expect(cachedUrls.some((url) => url.endsWith("/"))).toBe(true);
});
