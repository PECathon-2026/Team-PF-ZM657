// @vitest-environment jsdom
// Tests for lib/sanitize-html.ts. The comment above gives these tests a fake
// browser DOM (jsdom), because DOMPurify needs one. Run with: npm test
import { describe, expect, it } from "vitest";
import { sanitizeArticleHtml } from "@/lib/sanitize-html";

const ARTICLE_URL = "https://www.nasa.gov/es/news-release/example-article/";

/** Sanitizes and returns a <div> holding the result, so tests can query it. */
function render(html: string, baseUrl = ARTICLE_URL): HTMLDivElement {
  const container = document.createElement("div");
  container.replaceChildren(sanitizeArticleHtml(html, baseUrl));
  return container;
}

describe("sanitizeArticleHtml – links", () => {
  it("keeps an ordinary absolute hyperlink clickable (NASA case)", () => {
    const html = `<p><em>Read this release in English <a href="https://www.nasa.gov/news-release/send-your-name-to-titan-aboard-nasas-dragonfly-mission/">here</a>.</em></p>`;
    const link = render(html).querySelector("a");

    expect(link?.textContent).toBe("here");
    expect(link?.getAttribute("href")).toBe(
      "https://www.nasa.gov/news-release/send-your-name-to-titan-aboard-nasas-dragonfly-mission/",
    );
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer nofollow ugc");
  });

  it("resolves a relative hyperlink against the article URL", () => {
    const container = render(`<p>See <a href="/news-release/english-version/">here</a> and <a href="next/">next</a>.</p>`);
    const [rootRelative, pathRelative] = container.querySelectorAll("a");

    expect(rootRelative.getAttribute("href")).toBe("https://www.nasa.gov/news-release/english-version/");
    expect(pathRelative.getAttribute("href")).toBe("https://www.nasa.gov/es/news-release/example-article/next/");
  });

  it("leaves text with no links unchanged", () => {
    const container = render("<p>Plain paragraph with <strong>bold</strong> text.</p>");
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.innerHTML).toBe("<p>Plain paragraph with <strong>bold</strong> text.</p>");
  });

  it.each([
    ["javascript:alert(1)"],
    ["JaVaScRiPt:alert(1)"],
    [" javascript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["vbscript:msgbox(1)"],
    ["mailto:someone@example.com"],
  ])("removes unsafe or non-http URL schemes but keeps the text: %s", (href) => {
    const container = render(`<p>Click <a href="${href}">me</a></p>`);
    const link = container.querySelector("a");

    expect(container.textContent).toBe("Click me");
    expect(link?.hasAttribute("href")).toBe(false);
  });
});

describe("sanitizeArticleHtml – dangerous markup", () => {
  it("removes scripts, event handlers, iframes, forms and styles", () => {
    const container = render(`
      <p onclick="alert(1)" style="color:red">Hello</p>
      <script>alert("xss")</script>
      <img src="x" onerror="alert(1)">
      <iframe src="https://evil.example"></iframe>
      <form action="https://evil.example"><input name="password"></form>
      <svg><script>alert(1)</script></svg>
      <a href="https://ok.example" onmouseover="alert(1)">safe link</a>
      <style>body { display: none }</style>
    `);
    const output = container.innerHTML;

    expect(output).not.toMatch(/<script|<iframe|<form|<input|<img|<svg|<style/i);
    expect(output).not.toMatch(/onclick|onerror|onmouseover|style=/i);
    expect(output).not.toContain("alert");
    expect(container.querySelector("p")?.textContent).toBe("Hello");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://ok.example/");
  });

  it("does not load remote images (privacy)", () => {
    expect(render(`<p><img src="https://tracker.example/pixel.gif">Text</p>`).querySelector("img")).toBeNull();
  });
});
