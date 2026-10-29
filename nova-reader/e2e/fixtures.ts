// Shared helpers for the e2e tests. The real /api/feed and /api/article need the
// internet, so most tests answer them with fixed JSON (page.route). The SSRF and
// header tests call the REAL routes.
import type { Page } from "@playwright/test";
import { ARTICLE_PAGE_HTML, ARTICLE_PAGE_URL } from "../tests/helpers/article-fixture";

export const FEED_URL = "https://blog.example/feed.xml";

export const FEED_RESPONSE = {
  success: true,
  feed: { title: "The Small Web Journal", description: "Essays about blogs and feeds.", siteUrl: "https://blog.example/", feedUrl: FEED_URL },
  items: [
    { id: "e2e-1", title: "Why feeds still matter", url: ARTICLE_PAGE_URL, summary: "Feeds let readers follow writers directly.", author: "Meera Kaur", publishedAt: "2026-10-25T09:00:00.000Z", categories: ["Feeds", "Privacy"] },
    { id: "e2e-2", title: "Private search compared", url: "https://blog.example/search", summary: "Privacy focused search engines.", publishedAt: "2026-10-20T09:00:00.000Z", categories: ["Privacy"] },
  ],
};

export async function mockApis(page: Page) {
  await page.route("**/api/feed?**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FEED_RESPONSE) }));
  await page.route("**/api/article?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, page: { url: ARTICLE_PAGE_URL, html: ARTICLE_PAGE_HTML } }) }),
  );
}

export async function loadFeed(page: Page) {
  await page.getByLabel("RSS or Atom feed URL").fill(FEED_URL);
  await page.getByRole("button", { name: "Load feed" }).click();
  await page.getByRole("heading", { name: "The Small Web Journal" }).waitFor();
}

/** Collects Content-Security-Policy violations reported by the browser. */
export async function watchCspViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { __csp: string[] }).__csp.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}
