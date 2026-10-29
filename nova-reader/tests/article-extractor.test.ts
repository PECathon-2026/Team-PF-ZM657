// @vitest-environment jsdom
// Tests for lib/article-extractor.ts (Readability) together with lib/sanitize-html.ts.
import { afterEach, describe, expect, it } from "vitest";
import { extractReadableArticle, MAX_ELEMENTS_TO_PARSE } from "@/lib/article-extractor";
import { sanitizeArticleHtml } from "@/lib/sanitize-html";
import { ARTICLE_PAGE_HTML, ARTICLE_PAGE_URL, NOT_AN_ARTICLE_HTML } from "./helpers/article-fixture";

const FEED_ITEM_URL = "https://blog.example/?p=42"; // the URL the feed gave us (storage key)

type Flags = Window & { __pageScriptRan?: boolean; __imgHandlerRan?: boolean; __clickRan?: boolean };

/** Extract, then sanitize exactly like the reader view does, and return the DOM. */
function extractAndRender() {
  const result = extractReadableArticle(ARTICLE_PAGE_HTML, ARTICLE_PAGE_URL, FEED_ITEM_URL);
  if (!result.ok) throw new Error(`extraction failed: ${result.reason}`);
  const container = document.createElement("div");
  container.replaceChildren(sanitizeArticleHtml(result.article.contentHtml, result.article.pageUrl));
  return { article: result.article, container };
}

afterEach(() => {
  const w = window as Flags;
  delete w.__pageScriptRan;
  delete w.__imgHandlerRan;
  delete w.__clickRan;
});

describe("extractReadableArticle", () => {
  it("extracts the main article text and metadata", () => {
    const { article, container } = extractAndRender();
    expect(article).toMatchObject({
      url: FEED_ITEM_URL,
      pageUrl: ARTICLE_PAGE_URL,
      title: "Why feeds still matter",
      siteName: "Example Blog",
      publishedTime: "2026-10-25T09:00:00Z",
    });
    expect(article.byline).toContain("Meera Kaur");
    expect(article.textLength).toBeGreaterThan(500);
    expect(container.textContent).toContain("Feeds let readers follow independent writers directly");
    expect(container.textContent).toContain("The weak spot has always been discovery.");
  });

  it("removes navigation, ads, cookie banners and footers", () => {
    const { container } = extractAndRender();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/Shop our merch|BUY CHEAP WIDGETS|ACCEPT ALL COOKIES|Newsletter signup/);
  });

  it("resolves relative links against the page URL (ignoring the page's own <base>)", () => {
    const { container } = extractAndRender();
    const history = [...container.querySelectorAll("a")].find((a) => a.textContent === "history of RSS");
    expect(history?.getAttribute("href")).toBe("https://blog.example/2026/09/history-of-rss/");
    expect(container.innerHTML).not.toContain("evil.example");
  });

  it("keeps safe links clickable and opens them safely", () => {
    const { container } = extractAndRender();
    const atom = [...container.querySelectorAll("a")].find((a) => a.textContent === "Atom spec");
    expect(atom?.getAttribute("href")).toBe("https://other.example/atom");
    expect(atom?.getAttribute("target")).toBe("_blank");
    expect(atom?.getAttribute("rel")).toBe("noopener noreferrer nofollow ugc");
  });

  it("never executes or keeps unsafe content", () => {
    const { container } = extractAndRender();
    const html = container.innerHTML;
    const w = window as Flags;

    expect(w.__pageScriptRan).toBeUndefined();
    expect(w.__imgHandlerRan).toBeUndefined();
    expect(html).not.toMatch(/<script|<iframe|<img|<style|onerror|onclick|style=|javascript:/i);
    // The text stays, but it is no longer a link (Readability or our sanitizer removes it).
    expect(container.textContent).toContain("Click for a prize");
    const prize = [...container.querySelectorAll("a")].find((a) => a.textContent === "Click for a prize");
    expect(prize === undefined || !prize.hasAttribute("href")).toBe(true);
    (container.querySelector("p") as HTMLElement).click();
    expect(w.__clickRan).toBeUndefined();
  });

  it("keeps simple tables", () => {
    const { container } = extractAndRender();
    expect(container.querySelector("table td")?.textContent).toBe("RSS 2.0");
  });

  it("does not change the HTML string it was given", () => {
    const copy = String(ARTICLE_PAGE_HTML);
    extractReadableArticle(ARTICLE_PAGE_HTML, ARTICLE_PAGE_URL, FEED_ITEM_URL);
    expect(ARTICLE_PAGE_HTML).toBe(copy);
  });
});

describe("extractReadableArticle – failures", () => {
  it("fails clearly for pages without an article", () => {
    const result = extractReadableArticle(NOT_AN_ARTICLE_HTML, "https://blog.example/", FEED_ITEM_URL);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["NO_ARTICLE_FOUND", "TOO_SHORT"]).toContain(result.reason);
      expect(result.message.length).toBeGreaterThan(10);
    }
  });

  it("fails for empty or non-HTML input", () => {
    for (const input of ["", "just some text", '{"json": true}']) {
      const result = extractReadableArticle(input, "https://blog.example/", FEED_ITEM_URL);
      expect(result.ok).toBe(false);
    }
  });

  it("refuses pages that are too complex to process", () => {
    const huge = `<html><body><article>${"<span>x</span>".repeat(MAX_ELEMENTS_TO_PARSE + 10)}</article></body></html>`;
    const result = extractReadableArticle(huge, "https://blog.example/", FEED_ITEM_URL);
    expect(result).toMatchObject({ ok: false, reason: "TOO_COMPLEX" });
  });
});
