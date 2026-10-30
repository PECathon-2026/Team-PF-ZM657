// Shared browser-side helper for calling OUR API routes (/api/feed, /api/article).
// Runs in the BROWSER. Plain functions, no React, so it is easy to test.
//
// It adds a timeout, supports cancelling, checks the JSON shape with Zod and
// turns every failure into a predictable result. It never throws.

import type { z } from "zod";
import type { ApiErrorCode } from "./feed-types";

/** Extra error codes that only the browser can produce. */
export type ClientErrorCode = "NETWORK_ERROR" | "CLIENT_TIMEOUT" | "BAD_RESPONSE" | "CANCELLED";

export type ApiFailure = {
  ok: false;
  code: ApiErrorCode | ClientErrorCode;
  message: string;
  /** true when trying the same request again might work (timeouts, server problems). */
  retryable: boolean;
};

export type ApiRequestOptions = {
  signal?: AbortSignal; // lets the caller cancel an old request
  timeoutMs?: number; // browser-side safety net; the server has its own limits
  fetchImpl?: typeof fetch; // tests pass a fake
};

/** Errors where retrying makes sense. */
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

export const DEFAULT_TIMEOUT_MS = 20_000;

/** Any API response: `{ success: true, ... }` or `{ success: false, error }`. */
type ApiSchema = z.ZodType<{ success: true } | { success: false; error: { code: ApiErrorCode; message: string } }>;

/**
 * GETs `path` from our own server and checks the JSON with `schema`.
 * Returns `{ ok: true, data }` (the parsed success body) or an ApiFailure.
 */
export async function getApiJson<S extends ApiSchema>(
  path: string,
  schema: S,
  options: ApiRequestOptions = {},
): Promise<{ ok: true; data: Extract<z.infer<S>, { success: true }> } | ApiFailure> {
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
      response = await fetchImpl(path, { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal });
    } catch {
      return abortOrNetworkFailure(timedOut, options.signal);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      if (controller.signal.aborted) return abortOrNetworkFailure(timedOut, options.signal);
      // For example an HTML error page from a proxy or hosting platform.
      return apiFailure("BAD_RESPONSE", `The server sent an unexpected response (HTTP ${response.status}). Please try again.`);
    }

    const parsed = schema.safeParse(data);
    if (!parsed.success) return apiFailure("BAD_RESPONSE", "The server sent an unexpected response. Please try again.");
    const body = parsed.data;
    if (!body.success) return apiFailure(body.error.code, body.error.message);
    return { ok: true, data: body as Extract<z.infer<S>, { success: true }> };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}

function abortOrNetworkFailure(timedOut: boolean, callerSignal: AbortSignal | undefined): ApiFailure {
  if (callerSignal?.aborted) return apiFailure("CANCELLED", "The request was cancelled.");
  if (timedOut) return apiFailure("CLIENT_TIMEOUT", "Loading took too long. Check your connection and try again.");
  return apiFailure("NETWORK_ERROR", "Could not reach the NOVA Reader server. Check your connection and try again.");
}

/** Builds a failure result; `retryable` is decided from the code. */
export function apiFailure(code: ApiErrorCode | ClientErrorCode, message: string): ApiFailure {
  return { ok: false, code, message, retryable: RETRYABLE_CODES.has(code) };
}
