// Errors the feed route expects and can explain to users safely.
// Runs on the SERVER only.
//
// Rule: `message` is shown to the user, so it must never contain stack traces,
// resolved IP addresses, internal hostnames or raw error text from Node.js.

import "server-only";
import type { ApiErrorCode } from "@/lib/feed-types";

export class FeedRouteError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "FeedRouteError";
  }
}

/** True for errors caused by our timeout (AbortSignal.timeout) or an abort. */
export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}
