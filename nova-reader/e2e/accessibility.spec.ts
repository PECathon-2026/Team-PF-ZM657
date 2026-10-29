// Automated accessibility checks with axe-core (WCAG 2.2 A/AA + best practices), light and dark (Stage 9).
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { loadFeed, mockApis } from "./fixtures";

const axePath = path.join(process.cwd(), "node_modules", "axe-core", "axe.min.js");

async function violations(page: Page) {
  await page.addScriptTag({ path: axePath });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const result = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } });
    return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} mode`, () => {
    test.use({ colorScheme });

    test("home, reader, radar and 404 have no axe violations", async ({ page }) => {
      await mockApis(page);
      await page.goto("/");
      await expect(page.getByText(/Local AI/).first()).toBeVisible();
      expect(await violations(page), "home (empty)").toEqual([]);

      await loadFeed(page);
      await page.locator("#main > div").first().getByRole("article", { name: "Why feeds still matter" }).getByRole("button", { name: /^Save/ }).click();
      expect(await violations(page), "home (feed)").toEqual([]);

      await page.locator("#main > div").first().getByRole("article", { name: "Why feeds still matter" }).getByRole("button", { name: /^Read/ }).click();
      await expect(page.getByRole("dialog").locator(".article-content")).toBeVisible();
      expect(await violations(page), "reader").toEqual([]);
      await page.keyboard.press("Escape");

      await page.goto("/radar");
      await expect(page.getByRole("heading", { name: "Topics in your saved articles" })).toBeVisible();
      expect(await violations(page), "radar").toEqual([]);

      await page.goto("/missing-page");
      expect(await violations(page), "404").toEqual([]);
    });
  });
}

test("keyboard: skip link, form, and closing the reader return focus", async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.getByLabel("RSS or Atom feed URL").focus();
  await page.keyboard.type("https://blog.example/feed.xml");
  await page.keyboard.press("Enter");
  const read = page.locator("#main > div").first().getByRole("article", { name: "Why feeds still matter" }).getByRole("button", { name: /^Read/ });
  await read.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(read).toBeFocused(); // the native <dialog> gives focus back
});
