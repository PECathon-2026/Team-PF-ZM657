// Browser-side helper that loads a feed through OUR server route
// (GET /api/feed?url=...). The browser never fetches feed URLs directly.
// Runs in the BROWSER. It is a plain function (no React), so it is easy to test.

import type { ApiErrorCode, FeedInfo, FeedItem } from "./feed-types";
import { feedApiResponseSchema, validateFeedUrl } from "./validation";

/** Extra error codes that only the browser can produce. */
export type ClientErrorCode = "NETWORK_ERROR" | "CLIENT_TIMEOUT" | "BAD_RESPONSE" | "CANCELLED";

export type FeedLoadResult =
  | { ok: true; feed: FeedInfo; items: FeedItem[] }
  | {
      ok: false;
      code: ApiErrorCode | ClientErrorCode;
      message: string;
      /** true when trying the same URL again might work (timeouts, server problems). */
      retryable: boolean;
    };

export type LoadFeedOptions = {
  signal?: AbortSignal; // lets the page cancel an old request when a new one starts
  timeoutMs?: number; // browser-side safety net; the server has its own 10 s limit
  fetchImpl?: typeof fetch; // tests pass a fake
};

/** Errors where retrying the same URL makes sense. */
const RETRYABLE_CODES = new Set<ApiErrorCode | ClientErrorCode>([
  "TIMEOUT",
  "CLIENT_TIMEOUT",
  "FETCH_FAILED",
  "UPSTREAM_ERROR",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "NETWORK_ERROR",
  "BAD_RESPONSE",
]);

const DEFAULT_TIMEOUT_MS = 20_000;

/** Builds the API path with the feed URL safely encoded. */
export function buildFeedApiUrl(feedUrl: string): string {
  return `/api/feed?url=${encodeURIComponent(feedUrl)}`;
}

/**
 * Loads and checks a feed. Never throws: every outcome is a FeedLoadResult.
 * Steps: validate the URL → call /api/feed → check the JSON shape with Zod.
 */
export async function loadFeed(feedUrl: string, options: LoadFeedOptions = {}): Promise<FeedLoadResult> {
  const checked = validateFeedUrl(feedUrl);
  if (!checked.ok) return failure(checked.code, checked.message);

  const fetchImpl = options.fetchImpl ?? fetch;

  // One controller that aborts on EITHER our timeout or the caller's signal.
  // (Written by hand instead of AbortSignal.any() so older browsers work too.)
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const cancel = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", cancel);

  try {
    let response: Response;
    try {
      response = await fetchImpl(buildFeedApiUrl(checked.url), {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch {
      return abortOrNetworkFailure(timedOut, options.signal);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      if (controller.signal.aborted) return abortOrNetworkFailure(timedOut, options.signal);
      // For example an HTML error page from a proxy or hosting platform.
      return failure("BAD_RESPONSE", `The server sent an unexpected response (HTTP ${response.status}). Please try again.`);
    }
    return interpret(data);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}

/** Checks the JSON shape with Zod and turns it into a FeedLoadResult. */
function interpret(data: unknown): FeedLoadResult {
  const parsed = feedApiResponseSchema.safeParse(data);
  if (!parsed.success) {
    return failure("BAD_RESPONSE", "The server sent an unexpected response. Please try again.");
  }
  if (!parsed.data.success) {
    return failure(parsed.data.error.code, parsed.data.error.message);
  }
  return { ok: true, feed: parsed.data.feed, items: parsed.data.items };
}

function abortOrNetworkFailure(timedOut: boolean, callerSignal: AbortSignal | undefined): FeedLoadResult {
  if (callerSignal?.aborted) return failure("CANCELLED", "The request was cancelled.");
  if (timedOut) return failure("CLIENT_TIMEOUT", "Loading took too long. Check your connection and try again.");
  return failure("NETWORK_ERROR", "Could not reach the NOVA Reader server. Check your connection and try again.");
}

function failure(code: ApiErrorCode | ClientErrorCode, message: string): FeedLoadResult {
  return { ok: false, code, message, retryable: RETRYABLE_CODES.has(code) };
}
