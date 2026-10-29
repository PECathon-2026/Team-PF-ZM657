// The logic behind GET /api/feed?url=<encoded-feed-url>.
// Runs on the SERVER only. app/api/feed/route.ts just calls handleFeedRequest().
// (Kept here because Next.js route files may only export HTTP handlers, and
// tests need to pass fake DNS / network / rate-limit dependencies.)
//
// Steps: rate limit → validate URL → safe download → parse → JSON.
// The server does not store feed URLs, feed contents or IP addresses.

import "server-only";
import { FeedParseError, parseFeedXml } from "@/lib/feed-parser";
import type { ApiErrorCode, FeedApiFailure, FeedApiSuccess } from "@/lib/feed-types";
import { validateFeedUrl } from "@/lib/validation";
import { FeedRouteError, isTimeoutError } from "./errors";
import { fetchFeedXml, type FetchFeedOptions } from "./feed-fetcher";
import { feedRateLimiter, getClientKey, type RateLimiter } from "./rate-limit";

export type FeedHandlerDeps = {
  rateLimiter?: RateLimiter;
  fetchOptions?: FetchFeedOptions; // tests: fake resolver / transport / short timeouts
};

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
};

export async function handleFeedRequest(request: Request, deps: FeedHandlerDeps = {}): Promise<Response> {
  // Read request data BEFORE the try block. In Next.js, reading request.url or
  // headers marks the route as dynamic by throwing an internal signal during
  // the build; our catch block must not swallow it.
  const rawUrl = new URL(request.url).searchParams.get("url");
  const clientKey = getClientKey(request);

  try {
    const limit = (deps.rateLimiter ?? feedRateLimiter).check(clientKey);
    if (!limit.allowed) {
      return errorJson("RATE_LIMITED", 429, "Too many requests. Please wait a minute and try again.", {
        "Retry-After": String(limit.retryAfterSeconds),
      });
    }

    const checked = validateFeedUrl(rawUrl); // Stage 2 validation (fast, before any network work)
    if (!checked.ok) throw new FeedRouteError(checked.code, 400, checked.message);

    const { xml, finalUrl } = await fetchFeedXml(checked.url, deps.fetchOptions);
    const { items, ...feed } = parseFeedXml(xml, finalUrl);

    const body: FeedApiSuccess = { success: true, feed, items };
    return Response.json(body, { status: 200, headers: SECURITY_HEADERS });
  } catch (error) {
    const { code, status, message } = describeError(error);
    if (code === "INTERNAL_ERROR") {
      // Server log only. The browser gets a generic message, never this.
      console.error("[api/feed] unexpected error:", error);
    }
    return errorJson(code, status, message);
  }
}

function describeError(error: unknown): { code: ApiErrorCode; status: number; message: string } {
  if (error instanceof FeedRouteError) return { code: error.code, status: error.status, message: error.message };
  if (error instanceof FeedParseError) {
    const status = error.code === "RESPONSE_TOO_LARGE" ? 413 : 422;
    return { code: error.code, status, message: error.message };
  }
  if (isTimeoutError(error)) return { code: "TIMEOUT", status: 504, message: "The feed took too long to respond." };
  return { code: "INTERNAL_ERROR", status: 500, message: "Something went wrong while loading the feed." };
}

function errorJson(code: ApiErrorCode, status: number, message: string, extraHeaders: Record<string, string> = {}) {
  const body: FeedApiFailure = { success: false, error: { code, message } };
  return Response.json(body, { status, headers: { ...SECURITY_HEADERS, ...extraHeaders } });
}
