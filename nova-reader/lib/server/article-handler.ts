// The logic behind GET /api/article?url=<encoded-article-url> (Stage 6).
// Runs on the SERVER only. app/api/article/route.ts just calls handleArticleRequest().
//
// What it does: downloads ONE article web page with exactly the same SSRF
// protection, redirect checks, timeout and size limit as /api/feed, and returns
// the raw HTML inside JSON. It does NOT parse, extract or store anything —
// the browser does the extraction (Readability) and sanitizing (DOMPurify).
//
// Why JSON and not the HTML itself? Serving someone else's HTML from our own
// domain would let its scripts run as our site. Inside JSON, with
// `Content-Security-Policy: default-src 'none'` and `nosniff`, it is only data.

import "server-only";
import type { ApiErrorCode, ArticlePageApiSuccess } from "@/lib/feed-types";
import { validateFeedUrl } from "@/lib/validation";
import { FeedRouteError, isTimeoutError } from "./errors";
import { assertArticleContentType, fetchTextSafely, type FetchFeedOptions } from "./feed-fetcher";
import { articleRateLimiter, getClientKey, type RateLimiter } from "./rate-limit";
import { logError } from "@/lib/log";
import { errorJson, SECURITY_HEADERS } from "./responses";

/** Article pages are often bigger than feeds (inline CSS, scripts, markup). */
export const MAX_ARTICLE_BYTES = 3 * 1024 * 1024;

export type ArticleHandlerDeps = {
  rateLimiter?: RateLimiter;
  fetchOptions?: FetchFeedOptions; // tests: fake resolver / transport / short timeouts
};

export async function handleArticleRequest(request: Request, deps: ArticleHandlerDeps = {}): Promise<Response> {
  // Read request data BEFORE the try block (see feed-handler.ts for why).
  const rawUrl = new URL(request.url).searchParams.get("url");
  const clientKey = getClientKey(request);

  try {
    const limit = (deps.rateLimiter ?? articleRateLimiter).check(clientKey);
    if (!limit.allowed) {
      return errorJson("RATE_LIMITED", 429, "Too many requests. Please wait a minute and try again.", {
        "Retry-After": String(limit.retryAfterSeconds),
      });
    }

    // Same URL rules as feeds: http(s) only, no credentials, no local/private hosts.
    const checked = validateFeedUrl(rawUrl);
    if (!checked.ok) throw new FeedRouteError(checked.code, 400, checked.message);

    const { text, finalUrl } = await fetchTextSafely(
      checked.url,
      {
        accept: "text/html, application/xhtml+xml;q=0.9, */*;q=0.1",
        label: "article",
        maxBytesLabel: "3 MB",
        checkContentType: assertArticleContentType,
      },
      { maxBytes: MAX_ARTICLE_BYTES, ...deps.fetchOptions },
    );

    const body: ArticlePageApiSuccess = { success: true, page: { url: finalUrl, html: text } };
    return Response.json(body, { status: 200, headers: SECURITY_HEADERS });
  } catch (error) {
    const { code, status, message } = describeError(error);
    if (code === "INTERNAL_ERROR") logError("api/article", error); // redacted, no stack
    return errorJson(code, status, message);
  }
}

function describeError(error: unknown): { code: ApiErrorCode; status: number; message: string } {
  if (error instanceof FeedRouteError) return { code: error.code, status: error.status, message: error.message };
  if (isTimeoutError(error)) return { code: "TIMEOUT", status: 504, message: "The article took too long to respond." };
  return { code: "INTERNAL_ERROR", status: 500, message: "Something went wrong while loading the article." };
}
