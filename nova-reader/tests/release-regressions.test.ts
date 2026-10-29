// @vitest-environment jsdom
// Stage 10 release regression tests: unusual URL spellings that attackers use
// to sneak past SSRF checks, and tricky HTML that tries to slip past the
// sanitizer. No network or DNS is used. Run with: npm test
import { describe, expect, it } from "vitest";
import { FeedRouteError } from "@/lib/server/errors";
import { assertSafeDestination, isPublicIpAddress } from "@/lib/server/ssrf";
import { sanitizeArticleHtml } from "@/lib/sanitize-html";
import { validateFeedUrl } from "@/lib/validation";

function blockedOnServer(url: string): boolean {
  try {
    assertSafeDestination(url);
    return false;
  } catch (error) {
    expect(error).toBeInstanceOf(FeedRouteError);
    return true;
  }
}

describe("URL / SSRF edge cases", () => {
  // Every one of these means "this machine" or a private/metadata address.
  const sneakyPrivate = [
    "http://0x7f.1/feed", // hex + short form of 127.0.0.1
    "http://0177.0.0.1/feed", // octal
    "http://127.1/feed", // short form
    "http://2130706433/feed", // one big number = 127.0.0.1
    "http://0/feed", // 0.0.0.0
    "http://0x7f000001/feed",
    "http://169.254.169.254./latest/meta-data", // trailing dot, cloud metadata
    "http://LOCALHOST./feed", // upper case + trailing dot
    "http://localhost:80/feed",
    "http://foo.localhost/feed",
    "http://[::1]/feed",
    "http://[::]/feed",
    "http://[0:0:0:0:0:0:0:1]/feed",
    "http://[::ffff:127.0.0.1]/feed", // IPv4-mapped IPv6
    "http://[::ffff:a9fe:a9fe]/feed", // mapped 169.254.169.254
    "http://[::127.0.0.1]/feed", // deprecated IPv4-compatible form
    "http://[fe80::1]/feed",
    "http://[fd00::1]/feed",
    "http://[64:ff9b::7f00:1]/feed", // NAT64 to 127.0.0.1
    "http://[2002:7f00:1::]/feed", // 6to4 wrapping 127.0.0.1
    "http://100.100.100.200/feed", // Alibaba Cloud metadata
    "http://printer.local/feed",
    "http://metadata.google.internal/computeMetadata/v1/",
  ];

  it.each(sneakyPrivate)("blocks %s on the server", (url) => {
    expect(blockedOnServer(url)).toBe(true);
  });

  it("rejects IPv6 zone IDs (they cannot even be parsed as a URL)", () => {
    expect(validateFeedUrl("http://[fe80::1%25eth0]/feed").ok).toBe(false);
    expect(isPublicIpAddress("fe80::1%eth0")).toBe(false);
  });

  it("rejects credentials hidden with an encoded @ and backslash tricks", () => {
    expect(validateFeedUrl("http://user%40x:pw@example.com/feed").ok).toBe(false);
    // WHATWG URL treats "\" like "/", so the real host here is 127.0.0.1.
    expect(blockedOnServer("http://127.0.0.1\\@example.com/feed")).toBe(true);
  });

  it("rejects non-web schemes, including mixed case and leading spaces", () => {
    for (const url of [" JavaScript:alert(1)", "FILE:///etc/passwd", "gopher://example.com/", "ws://example.com/"]) {
      expect(validateFeedUrl(url).ok).toBe(false);
    }
  });

  it("blocks non-web ports even on public hosts", () => {
    expect(blockedOnServer("http://example.com:22/feed")).toBe(true);
    expect(blockedOnServer("http://example.com:6379/feed")).toBe(true);
  });

  it("still accepts normal public feeds, including IDN (punycode) hosts", () => {
    expect(blockedOnServer("https://example.com/feed.xml")).toBe(false);
    expect(blockedOnServer("https://8.8.8.8/feed")).toBe(false);
    const idn = validateFeedUrl("https://bücher.example/feed");
    expect(idn).toEqual({ ok: true, url: "https://xn--bcher-kva.example/feed" });
  });
});

describe("HTML sanitizer edge cases", () => {
  const BASE = "https://blog.example/post/";

  function render(html: string): HTMLDivElement {
    const div = document.createElement("div");
    div.replaceChildren(sanitizeArticleHtml(html, BASE));
    return div;
  }

  it("neutralizes javascript: links hidden with entities, tabs, case and whitespace", () => {
    const html = [
      '<a href="jav&#x09;ascript:alert(1)">a</a>',
      '<a href="&#106;avascript:alert(1)">b</a>',
      '<a href=" JAVASCRIPT:alert(1)">c</a>',
      '<a href="data:text/html,<script>alert(1)</script>">d</a>',
      '<a href="vbscript:msgbox(1)">e</a>',
    ].join("");
    const div = render(html);
    for (const link of div.querySelectorAll("a")) expect(link.hasAttribute("href")).toBe(false);
    expect(div.textContent).toBe("abcde");
  });

  it("removes SVG and MathML (namespace-confusion tricks)", () => {
    const div = render(
      '<svg><a href="javascript:alert(1)"><text>x</text></a><script>alert(1)</script></svg>' +
        '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>' +
        "<p>ok</p>",
    );
    expect(div.querySelector("svg, math, script, style, img")).toBeNull();
    expect(div.innerHTML).not.toMatch(/onerror|javascript:/i);
    expect(div.querySelector("p")?.textContent).toBe("ok");
  });

  it("drops style, srcset, data-* and event attributes; keeps only href and title", () => {
    const div = render(
      '<p style="background:url(https://tracker.example/p.gif)" data-x="1" onmouseover="alert(1)" title="t" class="c" id="i">hi</p>',
    );
    const p = div.querySelector("p")!;
    expect(p.getAttributeNames()).toEqual(["title"]);
  });

  it("loads nothing remote: no img, picture, video, audio, link, meta, object, embed, base", () => {
    const div = render(
      '<picture><source srcset="https://t.example/a.png"><img src="https://t.example/a.png"></picture>' +
        '<video src="https://t.example/v.mp4" poster="https://t.example/p.png"></video><audio src="https://t.example/a.mp3"></audio>' +
        '<link rel="stylesheet" href="https://t.example/s.css"><meta http-equiv="refresh" content="0;url=https://evil.example">' +
        '<object data="https://t.example/o"></object><embed src="https://t.example/e"><base href="https://evil.example/">' +
        "<p>text</p>",
    );
    expect(div.querySelector("picture, source, img, video, audio, link, meta, object, embed, base")).toBeNull();
    expect(div.innerHTML).not.toContain("t.example");
    expect(div.textContent).toBe("text");
  });

  it("makes every kept link open safely in a new tab", () => {
    const div = render('<a href="/other">x</a><a href="https://other.example/">y</a>');
    for (const link of div.querySelectorAll("a")) {
      expect(link.getAttribute("href")).toMatch(/^https:\/\//);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
      expect(link.getAttribute("rel")).toContain("noreferrer");
    }
  });

  it("survives malformed and deeply nested input without throwing", () => {
    const deep = "<div>".repeat(2000) + "deep" + "</div>".repeat(2000);
    expect(() => render(deep)).not.toThrow();
    expect(() => render("<p><b><i>unclosed <a href='https://x.example'>link")).not.toThrow();
    expect(render("<!-- <script>alert(1)</script> -->plain").innerHTML).not.toContain("script");
  });
});
