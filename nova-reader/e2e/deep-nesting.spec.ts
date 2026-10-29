// bugs.md #2 in a REAL browser: hostile, deeply nested HTML must not freeze the tab.
// The feed's own HTML and the downloaded article page are both nested thousands
// of levels deep. Before the fix, Chromium took over a second for the feed HTML
// and minutes for the 3 MB page; now both are refused before parsing.
import { expect, test } from "@playwright/test";
import { FEED_URL } from "./fixtures";

const ARTICLE_URL = "https://blog.example/deep";
const nested = (depth: number, inner: string) => "<div>".repeat(depth) + inner + "</div>".repeat(depth);

test("deeply nested feed HTML and article pages do not stall the reader", async ({ page }) => {
  const feedHtml = nested(18_000, "Deep feed text marker"); // the largest feed content the parser keeps (200 KB)
  const pageHtml = `<html><body>${nested(270_000, "<p>never shown</p>")}</body></html>`; // ~3 MB, the article limit
  await page.route("**/api/feed?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        feed: { title: "Hostile Feed", feedUrl: FEED_URL },
        items: [{ id: "deep-1", title: "Deeply nested post", url: ARTICLE_URL, summary: "Deep feed text marker", contentHtml: feedHtml }],
      }),
    }),
  );
  await page.route("**/api/article?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, page: { url: ARTICLE_URL, html: pageHtml } }) }),
  );

  await page.goto("/");
  await page.getByLabel("RSS or Atom feed URL").fill(FEED_URL);
  await page.getByRole("button", { name: "Load feed" }).click();
  await page.getByRole("heading", { name: "Hostile Feed" }).waitFor();

  const started = Date.now();
  await page.locator("#main > div").first().getByRole("article", { name: "Deeply nested post" }).getByRole("button", { name: /^Read/ }).click();
  const dialog = page.getByRole("dialog");
  // The feed text is shown (as plain text) and the full-article attempt fails cleanly.
  await expect(dialog.locator(".article-content").getByText("Deep feed text marker")).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByText("too large or complex", { exact: false })).toBeVisible({ timeout: 10_000 });
  expect(Date.now() - started).toBeLessThan(10_000);

  // The page is still responsive: the dialog closes with the keyboard.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
