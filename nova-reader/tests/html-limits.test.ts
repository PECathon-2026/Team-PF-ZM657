// @vitest-environment jsdom
// Tests for lib/html-limits.ts and how the sanitizer and article extractor use
// it (bugs.md #2: deeply nested HTML could stall the tab). Run with: npm test
import { describe, expect, it } from "vitest";
import { extractReadableArticle } from "@/lib/article-extractor";
import { isHtmlTooDeeplyNested, MAX_HTML_NESTING_DEPTH } from "@/lib/html-limits";
import { sanitizeArticleHtml } from "@/lib/sanitize-html";
import { ARTICLE_PAGE_HTML } from "./helpers/article-fixture";

const nested = (depth: number, tag = "div") => `<${tag}>`.repeat(depth) + "deep" + `</${tag}>`.repeat(depth);
const URL = "https://blog.example/post/";

// Generous time budget so a busy machine running many test files in parallel
// cannot make these tests flaky. The fixed code needs a few ms to ~200 ms; the
// old code needed seconds (2,000 levels in jsdom) to minutes (3 MB of nesting).
const BUDGET_MS = 3000;

function timeMs(action: () => void): number {
  const start = performance.now();
  action();
  return performance.now() - start;
}

describe("isHtmlTooDeeplyNested", () => {
  it("accepts nesting up to the limit and refuses one level more", () => {
    expect(isHtmlTooDeeplyNested(nested(MAX_HTML_NESTING_DEPTH))).toBe(false);
    expect(isHtmlTooDeeplyNested(nested(MAX_HTML_NESTING_DEPTH + 1))).toBe(true);
    expect(isHtmlTooDeeplyNested(nested(2000, "span"))).toBe(true);
  });

  it("counts unclosed tags (the browser would nest them too)", () => {
    expect(isHtmlTooDeeplyNested("<div>".repeat(MAX_HTML_NESTING_DEPTH + 1) + "x")).toBe(true);
    expect(isHtmlTooDeeplyNested("<DIV class='a'>".repeat(MAX_HTML_NESTING_DEPTH + 1))).toBe(true);
  });

  it("does not flag ordinary long articles", () => {
    expect(isHtmlTooDeeplyNested(ARTICLE_PAGE_HTML)).toBe(false);
    const longFlat = "<p>Paragraph with <a href='/x'>a link</a> and <em>emphasis</em>.</p>".repeat(5000);
    expect(isHtmlTooDeeplyNested(longFlat)).toBe(false);
  });

  it("ignores void tags, self-closing tags and tags whose end tag is optional", () => {
    const html = [
      "<br>".repeat(2000),
      "<img src=x>".repeat(2000),
      "<span/>".repeat(2000),
      "<p>unclosed paragraph".repeat(2000),
      "<ul>" + "<li>item".repeat(2000) + "</ul>",
      "<table>" + "<tr><td>cell".repeat(2000) + "</table>",
    ].join("");
    expect(isHtmlTooDeeplyNested(html)).toBe(false);
  });

  it("ignores tag-like text inside comments, scripts and styles", () => {
    expect(isHtmlTooDeeplyNested(`<!-- ${"<div>".repeat(2000)} -->ok`)).toBe(false);
    expect(isHtmlTooDeeplyNested(`<script>var s = "${"<div>".repeat(2000)}";</script>ok`)).toBe(false);
    expect(isHtmlTooDeeplyNested(`<style>/* ${"<div>".repeat(2000)} */</style>ok`)).toBe(false);
  });

  it("handles broken input without throwing", () => {
    for (const html of ["", "<", "<<<<", "a < b > c", "<!--", "<script>never closed <div>", "<div", "</div></div>"]) {
      expect(() => isHtmlTooDeeplyNested(html)).not.toThrow();
    }
  });

  it("is fast on 3 MB of hostile input (no backtracking)", () => {
    const threeMb = 3 * 1024 * 1024;
    const inputs = {
      unclosedTagStarts: "<a".repeat(threeMb / 2),
      deepDivs: "<div>".repeat(threeMb / 5),
      unclosedComments: "<!--".repeat(threeMb / 4),
      lessThanSigns: "<".repeat(threeMb),
      manyShallowTags: "<x></x>".repeat(threeMb / 7),
    };
    for (const [name, html] of Object.entries(inputs)) {
      expect({ name, slow: timeMs(() => isHtmlTooDeeplyNested(html)) > BUDGET_MS }).toEqual({ name, slow: false });
    }
  });
});

describe("sanitizeArticleHtml with deeply nested markup (bug #2)", () => {
  it("sanitizes 2,000 nested <div>s quickly and keeps the text", () => {
    let container!: HTMLDivElement;
    const ms = timeMs(() => {
      container = document.createElement("div");
      container.replaceChildren(sanitizeArticleHtml(nested(2000), URL));
    });
    expect(container.textContent).toBe("deep");
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("handles the largest feed content allowed (200,000 characters of nesting) quickly", () => {
    const html = nested(18_000);
    expect(html.length).toBeLessThanOrEqual(200_000);
    expect(timeMs(() => sanitizeArticleHtml(html, URL))).toBeLessThan(BUDGET_MS);
  });

  it("shows too-deep content as safe plain paragraphs, never as markup", () => {
    const html =
      "<div>".repeat(MAX_HTML_NESTING_DEPTH + 1) +
      "<p>First &amp; best</p><p>Second <script>alert(1)</script><img src=x onerror=alert(1)></p>";
    const container = document.createElement("div");
    container.replaceChildren(sanitizeArticleHtml(html, URL));
    const paragraphs = [...container.children];
    expect(paragraphs.map((p) => p.tagName)).toEqual(["P", "P"]);
    expect(paragraphs.map((p) => p.textContent)).toEqual(["First & best", "Second"]);
    expect(container.querySelector("script, img, div, a")).toBeNull();
  });

  it("still sanitizes normal content with DOMPurify (links stay clickable)", () => {
    const container = document.createElement("div");
    container.replaceChildren(sanitizeArticleHtml(nested(50) + '<a href="/x">link</a>', URL));
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://blog.example/x");
  });
});

describe("extractReadableArticle with deeply nested pages (bug #2)", () => {
  it("refuses a deeply nested page as TOO_COMPLEX before parsing it", () => {
    const page = `<html><body><article>${nested(50_000)}</article></body></html>`; // ~550 KB
    let result!: ReturnType<typeof extractReadableArticle>;
    const ms = timeMs(() => {
      result = extractReadableArticle(page, URL, URL);
    });
    expect(result).toMatchObject({ ok: false, reason: "TOO_COMPLEX" });
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("still extracts normal articles", () => {
    expect(extractReadableArticle(ARTICLE_PAGE_HTML, URL, URL).ok).toBe(true);
  });
});
