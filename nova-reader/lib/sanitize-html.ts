// Makes untrusted feed HTML safe to display.
// Runs in the BROWSER only (DOMPurify needs a real DOM). Tests use jsdom.
//
// Two steps:
//   1. DOMPurify removes everything not on a short allow-list: scripts, styles,
//      iframes, forms, event handlers (onclick=…), style attributes, images.
//   2. We check every link ourselves: resolve relative URLs against the
//      article's URL, allow only http(s), and open links in a new tab safely.

import DOMPurify from "dompurify";
import { toSafeHttpUrl } from "./utils";

// Simple reading formatting only. <img> is intentionally NOT allowed, so blogs
// cannot track readers with remote images (same privacy rule as the list view).
const ALLOWED_TAGS = [
  "a", "p", "br", "hr", "strong", "b", "em", "i", "u", "s", "small", "sub", "sup",
  "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "code",
  "ul", "ol", "li", "dl", "dt", "dd", "figure", "figcaption", "span", "div",
  // Stage 6: tables and a few semantic tags that extracted articles often use.
  "table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td",
  "section", "article", "header", "footer", "aside", "mark", "abbr", "cite", "q", "time", "kbd", "samp", "var",
];
const ALLOWED_ATTR = ["href", "title"];

/**
 * Sanitizes feed HTML and returns a DocumentFragment that can be inserted
 * into the page with `element.replaceChildren(fragment)`.
 *
 * @param html    Untrusted HTML from the feed (`contentHtml`).
 * @param baseUrl The article's own URL. Relative links like "/es/about"
 *                are resolved against it, as they would be on the original page.
 */
export function sanitizeArticleHtml(html: string, baseUrl: string): DocumentFragment {
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Stage 10: DOMPurify keeps data-* attributes by default. Feeds have no use
    // for them, so drop them too (smaller attack surface, nothing for scripts to read).
    ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });

  for (const link of fragment.querySelectorAll("a")) {
    secureLink(link, baseUrl);
  }
  return fragment;
}

/** Makes one <a> safe. Unsafe or broken links keep their text but stop being links. */
function secureLink(link: HTMLAnchorElement, baseUrl: string): void {
  const safeUrl = toSafeHttpUrl(link.getAttribute("href") ?? undefined, baseUrl);
  if (!safeUrl) {
    link.removeAttribute("href"); // e.g. javascript:, data:, mailto:, or empty
    return;
  }
  link.setAttribute("href", safeUrl);
  link.setAttribute("target", "_blank");
  // noopener/noreferrer: the new tab cannot control this page or see where you came from.
  // nofollow/ugc: standard hints that the link comes from third-party content.
  link.setAttribute("rel", "noopener noreferrer nofollow ugc");
}
