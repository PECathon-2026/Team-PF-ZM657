// Extracts the main article from a downloaded web page, using Mozilla Readability.
// Runs in the BROWSER (needs DOMParser). Tests run it in jsdom.
//
// Safety:
//   - DOMParser builds an INERT document: scripts never run, images, styles and
//     iframes are never loaded. Nothing from the page touches the real page.
//   - Readability changes the document it reads, so it gets a CLONE.
//   - The returned `contentHtml` is still UNTRUSTED. It is sanitized with
//     DOMPurify (lib/sanitize-html.ts) every time it is displayed.

import { Readability } from "@mozilla/readability";
import type { ExtractedArticle } from "./feed-types";
import { isHtmlTooDeeplyNested } from "./html-limits";
import { normalizeWhitespace, truncate } from "./utils";

/** Pages with more elements than this are not processed (protects the browser tab). */
export const MAX_ELEMENTS_TO_PARSE = 25_000;
/** Below this many characters of text, the result is probably not a real article. */
export const MIN_ARTICLE_TEXT_LENGTH = 250;
/** Extracted HTML larger than this is refused (keeps storage and rendering reasonable). */
export const MAX_EXTRACTED_HTML_LENGTH = 500_000;

export type ExtractionFailureReason = "NOT_HTML" | "TOO_COMPLEX" | "NO_ARTICLE_FOUND" | "TOO_SHORT" | "TOO_LARGE";

export type ExtractionResult =
  | { ok: true; article: ExtractedArticle }
  | { ok: false; reason: ExtractionFailureReason; message: string };

const MESSAGES: Record<ExtractionFailureReason, string> = {
  NOT_HTML: "The page could not be read as a web page.",
  TOO_COMPLEX: "The page is too large or complex to turn into a reading view.",
  NO_ARTICLE_FOUND: "No main article text was found on the page (it may be a home page, a video, or need JavaScript).",
  TOO_SHORT: "Only a little text was found on the page, so it does not look like a full article.",
  TOO_LARGE: "The extracted article is too large to show in the reading view.",
};

/**
 * @param html       Raw page HTML from /api/article (untrusted).
 * @param pageUrl    Final page URL (after redirects). Relative links are resolved against it.
 * @param articleUrl The article URL from the feed, used as the storage key.
 */
export function extractReadableArticle(html: string, pageUrl: string, articleUrl: string): ExtractionResult {
  // Checked BEFORE parsing: very deep nesting makes DOMParser itself extremely
  // slow, so the element limit below would come too late. See lib/html-limits.ts.
  if (isHtmlTooDeeplyNested(html)) return failure("TOO_COMPLEX");

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return failure("NOT_HTML");
  }
  if (!doc.body) return failure("NOT_HTML");

  // Tell the inert document where it came from, so Readability turns relative
  // links into absolute ones. (Replaces any <base> the page set itself.)
  doc.querySelectorAll("base").forEach((element) => element.remove());
  const base = doc.createElement("base");
  base.setAttribute("href", pageUrl);
  doc.head?.prepend(base);

  let parsed: ReturnType<Readability["parse"]>;
  try {
    const clone = doc.cloneNode(true) as Document; // Readability modifies the DOM it reads
    parsed = new Readability(clone, { maxElemsToParse: MAX_ELEMENTS_TO_PARSE, keepClasses: false }).parse();
  } catch {
    // Readability throws when maxElemsToParse is exceeded.
    return failure("TOO_COMPLEX");
  }

  if (!parsed?.content) return failure("NO_ARTICLE_FOUND");
  const textLength = normalizeWhitespace(parsed.textContent ?? "").length;
  if (textLength < MIN_ARTICLE_TEXT_LENGTH) return failure("TOO_SHORT");
  if (parsed.content.length > MAX_EXTRACTED_HTML_LENGTH) return failure("TOO_LARGE");

  return {
    ok: true,
    article: {
      url: articleUrl,
      pageUrl,
      title: clean(parsed.title, 500),
      byline: clean(parsed.byline, 300),
      siteName: clean(parsed.siteName, 200),
      excerpt: clean(parsed.excerpt, 1000),
      lang: clean(parsed.lang, 35),
      publishedTime: clean(parsed.publishedTime, 64),
      contentHtml: parsed.content,
      textLength,
      extractedAt: new Date().toISOString(),
    },
  };
}

function clean(value: string | null | undefined, max: number): string | undefined {
  const text = normalizeWhitespace(value ?? "");
  return text ? truncate(text, max) : undefined;
}

function failure(reason: ExtractionFailureReason): ExtractionResult {
  return { ok: false, reason, message: MESSAGES[reason] };
}
