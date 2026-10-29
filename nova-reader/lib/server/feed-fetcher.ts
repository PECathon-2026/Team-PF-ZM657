// Downloads a feed (or, since Stage 6, an article page) safely: validated
// destinations, limited redirects, one overall timeout, size limit, status
// check, content-type check, charset. Runs on the SERVER only.
// It returns raw text; parsing/extraction happens elsewhere.

import "server-only";
import { FeedRouteError, isTimeoutError } from "./errors";
import { httpGetOnce, isRedirectStatus, type Transport } from "./http-client";
import { assertSafeDestination, createPinnedLookup, systemResolver, type HostResolver } from "./ssrf";

export const FETCH_LIMITS = {
  timeoutMs: 10_000, // whole download, including every redirect
  maxBytes: 2 * 1024 * 1024, // 2 MB, same limit as the Stage 2 parser
  maxRedirects: 3,
} as const;

export type FetchFeedOptions = {
  resolver?: HostResolver; // tests use a fake DNS; production uses the system resolver
  transport?: Transport; // tests use a fake network; production uses httpGetOnce
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};

export type FetchedFeed = {
  xml: string;
  finalUrl: string; // after redirects; used to resolve relative links
};

const BASE_HEADERS = {
  "Accept-Encoding": "gzip, deflate, br",
  "User-Agent": "NOVA-Reader/0.1 (hackathon MVP feed reader)",
};

const FEED_ACCEPT = "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.1";

/** What is being downloaded; only changes the wording of error messages and headers. */
export type SafeTextRequest = {
  accept: string; // HTTP Accept header
  label: "feed" | "article"; // used in messages: "The feed took too long…"
  maxBytesLabel: string; // e.g. "2 MB", shown when the size limit is hit
  checkContentType: (contentType: string, body: string) => void; // throws FeedRouteError if wrong
};

export type FetchedText = {
  text: string;
  finalUrl: string; // after redirects
};

/**
 * Downloads the feed at `rawUrl` and returns its XML text.
 * @throws FeedRouteError with a safe, user-facing message.
 */
export async function fetchFeedXml(rawUrl: string, options: FetchFeedOptions = {}): Promise<FetchedFeed> {
  const { text, finalUrl } = await fetchTextSafely(
    rawUrl,
    { accept: FEED_ACCEPT, label: "feed", maxBytesLabel: "2 MB", checkContentType: assertFeedContentType },
    options,
  );
  return { xml: text, finalUrl };
}

/**
 * The shared, secure download loop (used for feeds and article pages).
 * Every hop (the first URL and every redirect target) goes through
 * assertSafeDestination(), and every connection uses the pinned DNS lookup.
 * @throws FeedRouteError with a safe, user-facing message.
 */
export async function fetchTextSafely(
  rawUrl: string,
  request: SafeTextRequest,
  options: FetchFeedOptions = {},
): Promise<FetchedText> {
  const transport = options.transport ?? httpGetOnce;
  const lookup = createPinnedLookup(options.resolver ?? systemResolver);
  const maxRedirects = options.maxRedirects ?? FETCH_LIMITS.maxRedirects;
  const maxBytes = options.maxBytes ?? FETCH_LIMITS.maxBytes;
  const signal = AbortSignal.timeout(options.timeoutMs ?? FETCH_LIMITS.timeoutMs);
  const headers = { ...BASE_HEADERS, Accept: request.accept };
  const { label } = request;

  let current = rawUrl;
  for (let redirects = 0; ; redirects++) {
    const url = assertSafeDestination(current);

    let response;
    try {
      response = await transport(url, { lookup, signal, maxBytes, headers });
    } catch (error) {
      if (error instanceof FeedRouteError) {
        if (error.code === "RESPONSE_TOO_LARGE") {
          throw new FeedRouteError("RESPONSE_TOO_LARGE", 413, `The ${label} is too large (limit is ${request.maxBytesLabel}).`);
        }
        if (error.code === "TIMEOUT") throw new FeedRouteError("TIMEOUT", 504, `The ${label} took too long to respond.`);
        if (error.code === "FETCH_FAILED" && error.message.startsWith("Could not connect")) {
          throw new FeedRouteError("FETCH_FAILED", 502, `Could not connect to the ${label}'s website.`);
        }
        throw error;
      }
      if (isTimeoutError(error) || signal.aborted) {
        throw new FeedRouteError("TIMEOUT", 504, `The ${label} took too long to respond.`);
      }
      throw new FeedRouteError("FETCH_FAILED", 502, `Could not connect to the ${label}'s website.`);
    }

    if (isRedirectStatus(response.status)) {
      if (redirects >= maxRedirects) {
        throw new FeedRouteError("TOO_MANY_REDIRECTS", 502, `The ${label} redirected too many times.`);
      }
      current = redirectTarget(response.headers.location, url, label);
      continue;
    }

    assertOkStatus(response.status, label);
    const contentType = headerValue(response.headers["content-type"]);
    const text = decodeBody(response.body, contentType);
    request.checkContentType(contentType, text);
    return { text, finalUrl: url.toString() };
  }
}

function redirectTarget(location: string | string[] | undefined, from: URL, label: string): string {
  const value = headerValue(location);
  if (!value) throw new FeedRouteError("UPSTREAM_ERROR", 502, `The ${label} server sent a broken redirect.`);
  try {
    return new URL(value, from).toString(); // relative redirects are resolved against the current URL
  } catch {
    throw new FeedRouteError("UPSTREAM_ERROR", 502, `The ${label} server sent a broken redirect.`);
  }
}

function assertOkStatus(status: number, label: string): void {
  // 204 (no content) and 206 (partial) cannot contain a complete document.
  if (status >= 200 && status < 300 && status !== 204 && status !== 206) return;
  throw new FeedRouteError("UPSTREAM_ERROR", 502, `The ${label} server answered with HTTP ${status}.`);
}

// --- Content type -------------------------------------------------------------

// Types that are XML but never a feed.
const NOT_FEED_XML = new Set(["image/svg+xml", "application/xhtml+xml"]);
// Types often (wrongly) used for feeds. Accepted only if the body looks like XML.
const LENIENT_TYPES = new Set(["", "text/plain", "application/octet-stream", "binary/octet-stream"]);

/**
 * Accepts XML media types (text/xml, application/xml, application/rss+xml,
 * application/atom+xml, application/rdf+xml, any "+xml"), plus a few generic
 * types when the body starts like XML. HTML, JSON, images, etc. are rejected.
 */
export function assertFeedContentType(contentType: string, body: string): void {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  const isXmlType = (mime.endsWith("/xml") || mime.endsWith("+xml")) && !NOT_FEED_XML.has(mime);
  if (isXmlType) return;
  if (LENIENT_TYPES.has(mime) && looksLikeXml(body)) return;

  const shown = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) ? mime : "an unknown type";
  const hint = mime === "text/html" ? " If this is a website, paste the address of its RSS or Atom feed instead." : "";
  throw new FeedRouteError(
    "UNSUPPORTED_CONTENT_TYPE",
    415,
    `This URL returned ${shown}, not an RSS or Atom feed.${hint}`,
  );
}

// Article pages must be HTML. PDFs, images, JSON, etc. are rejected.
const ARTICLE_TYPES = new Set(["text/html", "application/xhtml+xml"]);

/** Accepts HTML pages (and a missing/generic type when the body starts like HTML). */
export function assertArticleContentType(contentType: string, body: string): void {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  if (ARTICLE_TYPES.has(mime)) return;
  if (LENIENT_TYPES.has(mime) && /^\s*<(!doctype html|html|head|body)\b/i.test(body.replace(/^\uFEFF/, ""))) return;
  const shown = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) ? mime : "an unknown type";
  throw new FeedRouteError(
    "UNSUPPORTED_CONTENT_TYPE",
    415,
    `This link returned ${shown}, not a web page, so it cannot be shown in the reader.`,
  );
}

function looksLikeXml(body: string): boolean {
  return /^\s*</.test(body.replace(/^﻿/, ""));
}

// --- Character encoding ---------------------------------------------------------

/**
 * Decodes bytes to text using, in order: the Content-Type charset, a byte-order
 * mark, the <?xml encoding="..."?> declaration, then UTF-8.
 */
export function decodeBody(body: Buffer, contentType: string): string {
  const label = charsetFromHeader(contentType) ?? charsetFromBom(body) ?? charsetFromXmlDeclaration(body) ?? "utf-8";
  try {
    return new TextDecoder(label).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body); // unknown label → safe default
  }
}

function charsetFromHeader(contentType: string): string | undefined {
  return /charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType)?.[1];
}

function charsetFromBom(body: Buffer): string | undefined {
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) return "utf-8";
  if (body[0] === 0xff && body[1] === 0xfe) return "utf-16le";
  if (body[0] === 0xfe && body[1] === 0xff) return "utf-16be";
  return undefined;
}

function charsetFromXmlDeclaration(body: Buffer): string | undefined {
  const start = body.subarray(0, 256).toString("latin1");
  return /<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(start)?.[1];
}

function headerValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}
