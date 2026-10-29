// Shared JSON response helpers for the server routes (/api/feed, /api/article).
// Runs on the SERVER only.

import "server-only";
import type { ApiErrorCode, FeedApiFailure } from "@/lib/feed-types";

/**
 * Sent with every API response. The CSP and nosniff headers make sure a
 * response can never be treated as a web page, even if it contains HTML text.
 */
export const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
};

/** `{ success: false, error: { code, message } }` with the right status and headers. */
export function errorJson(
  code: ApiErrorCode,
  status: number,
  message: string,
  extraHeaders: Record<string, string> = {},
): Response {
  const body: FeedApiFailure = { success: false, error: { code, message } };
  return Response.json(body, { status, headers: { ...SECURITY_HEADERS, ...extraHeaders } });
}
