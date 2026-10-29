// GET /api/feed?url=<encoded-feed-url>
//
// Runs on the SERVER only (Next.js Route Handler).
// Why a server route? Browsers block most cross-site feed requests (CORS),
// so the server downloads the feed for the browser.
//
// Steps: validate URL → download with timeout + size limit → parse → return JSON.
// The server does not store feeds, URLs or anything about the user.

import { parseFeed, FeedParseError } from "@/lib/feed-parser";
import type { ApiErrorCode, FeedApiFailure, FeedApiSuccess } from "@/lib/feed-types";
import { validateFeedUrl } from "@/lib/validation";

const FETCH_TIMEOUT_MS = 10_000; // give up after 10 seconds
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB is plenty for a feed
const MAX_REDIRECTS = 3;

/** An error we expect and can explain to the user safely. */
class FeedRouteError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function GET(request: Request): Promise<Response> {
  // Read the query string OUTSIDE the try block. Reading request.url tells
  // Next.js "this route is dynamic"; it signals that with an internal error
  // that our catch block must not swallow.
  const rawUrl = new URL(request.url).searchParams.get("url");

  try {
    const checked = validateFeedUrl(rawUrl);
    if (!checked.ok) throw new FeedRouteError(checked.code, 400, checked.message);

    const { body, finalUrl } = await downloadFeed(checked.url);
    const feed = parseFeed(body, finalUrl);

    const { items, ...feedInfo } = feed;
    const response: FeedApiSuccess = { success: true, feed: feedInfo, items };
    return Response.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Downloads the feed. Follows redirects manually (max 3) so that every
 * redirect target is validated too — otherwise a public URL could redirect
 * to http://localhost.
 */
async function downloadFeed(startUrl: string): Promise<{ body: string; finalUrl: string }> {
  let currentUrl = startUrl;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const response = await fetchOnce(currentUrl);

    if (isRedirect(response.status)) {
      currentUrl = nextRedirectUrl(response, currentUrl);
      continue;
    }

    if (!response.ok) {
      throw new FeedRouteError("UPSTREAM_ERROR", 502, `The feed server answered with HTTP ${response.status}.`);
    }

    const body = await readLimitedText(response);
    return { body, finalUrl: currentUrl };
  }

  throw new FeedRouteError("TOO_MANY_REDIRECTS", 502, "The feed redirected too many times.");
}

/** One HTTP request. Network problems become a clear FETCH_FAILED or TIMEOUT error. */
async function fetchOnce(url: string): Promise<Response> {
  try {
    return await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5",
        "User-Agent": "NOVA-Reader/0.1 (hackathon MVP feed reader)",
      },
    });
  } catch (error) {
    if (isTimeout(error)) throw error; // handled in describeError
    // DNS failures, refused connections, TLS errors, etc.
    throw new FeedRouteError("FETCH_FAILED", 502, "Could not connect to the feed's website.");
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function nextRedirectUrl(response: Response, currentUrl: string): string {
  const location = response.headers.get("location");
  if (!location) throw new FeedRouteError("UPSTREAM_ERROR", 502, "The feed server sent a broken redirect.");

  let absolute: string;
  try {
    absolute = new URL(location, currentUrl).toString();
  } catch {
    throw new FeedRouteError("UPSTREAM_ERROR", 502, "The feed server sent a broken redirect.");
  }

  const checked = validateFeedUrl(absolute);
  if (!checked.ok) throw new FeedRouteError(checked.code, 400, `Redirect blocked: ${checked.message}`);
  return checked.url;
}

/** Reads the response body but stops as soon as it is bigger than MAX_RESPONSE_BYTES. */
async function readLimitedText(response: Response): Promise<string> {
  const tooLarge = () => new FeedRouteError("RESPONSE_TOO_LARGE", 413, "The feed is too large (limit is 2 MB).");

  const declaredLength = Number(response.headers.get("content-length"));
  if (declaredLength > MAX_RESPONSE_BYTES) throw tooLarge();
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }

  // MVP: decode as UTF-8, which almost all modern feeds use.
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/** Turns any error into a safe JSON response. Never sends stack traces to the browser. */
function errorResponse(error: unknown): Response {
  const { code, status, message } = describeError(error);
  if (status >= 500 && code === "INTERNAL_ERROR") {
    // Logged on the server only, so developers can debug.
    console.error("[api/feed] unexpected error:", error);
  }
  const body: FeedApiFailure = { success: false, error: { code, message } };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function describeError(error: unknown): { code: ApiErrorCode; status: number; message: string } {
  if (error instanceof FeedRouteError) {
    return { code: error.code, status: error.status, message: error.message };
  }
  if (error instanceof FeedParseError) {
    return { code: error.code, status: 422, message: error.message };
  }
  if (isTimeout(error)) {
    // Can happen while connecting or while the body is still downloading.
    return { code: "TIMEOUT", status: 504, message: "The feed took too long to respond (over 10 seconds)." };
  }
  return { code: "INTERNAL_ERROR", status: 500, message: "Something went wrong while loading the feed." };
}
