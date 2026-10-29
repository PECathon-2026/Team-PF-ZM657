// One shared set of error codes for the whole app (Stage 9). Runs on BOTH sides.
//
// Earlier stages already produce specific codes (API errors, browser fetch
// errors, storage errors, AI errors). This file maps all of them onto a small,
// stable list, used for error pages and for safe logging. User-facing messages
// never contain stack traces, file paths, URLs with secrets, or raw errors.

import type { ApiErrorCode } from "./feed-types";

export type AppErrorCode =
  | "UNKNOWN"
  | "NETWORK"
  | "TIMEOUT"
  | "VALIDATION"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "STORAGE"
  | "EXTRACTION"
  | "LOCAL_AI"
  | "UNSUPPORTED";

export type AppError = { code: AppErrorCode; message: string; retryable: boolean };

/** Plain-language messages for each code (used when no more specific message exists). */
export const APP_ERROR_MESSAGES: Record<AppErrorCode, string> = {
  UNKNOWN: "Something went wrong. Please try again.",
  NETWORK: "Could not connect. Check your internet connection and try again.",
  TIMEOUT: "This took too long. Please try again.",
  VALIDATION: "That input is not valid. Please check it and try again.",
  NOT_FOUND: "This page or item could not be found.",
  UNAUTHORIZED: "You are not allowed to do this.",
  RATE_LIMITED: "Too many requests. Please wait a minute and try again.",
  STORAGE: "This browser's local storage is not working. Saving and offline copies may not work.",
  EXTRACTION: "The full article could not be turned into a reading view.",
  LOCAL_AI: "Local AI stopped with an error. The rest of NOVA Reader still works.",
  UNSUPPORTED: "This browser does not support this feature. Everything else still works.",
};

const RETRYABLE = new Set<AppErrorCode>(["UNKNOWN", "NETWORK", "TIMEOUT", "RATE_LIMITED", "LOCAL_AI"]);

/** Maps a code from any earlier stage onto an AppErrorCode. Unknown codes → "UNKNOWN". */
export function toAppErrorCode(code: string): AppErrorCode {
  return CODE_MAP[code as keyof typeof CODE_MAP] ?? "UNKNOWN";
}

const CODE_MAP: Record<ApiErrorCode | string, AppErrorCode> = {
  // Server API codes (lib/feed-types.ts → API_ERROR_CODES)
  INVALID_URL: "VALIDATION",
  UNSUPPORTED_PROTOCOL: "VALIDATION",
  BLOCKED_HOST: "VALIDATION",
  TOO_MANY_REDIRECTS: "NETWORK",
  TIMEOUT: "TIMEOUT",
  FETCH_FAILED: "NETWORK",
  UPSTREAM_ERROR: "NETWORK",
  RESPONSE_TOO_LARGE: "VALIDATION",
  UNSUPPORTED_CONTENT_TYPE: "VALIDATION",
  RATE_LIMITED: "RATE_LIMITED",
  INVALID_XML: "VALIDATION",
  UNSUPPORTED_FORMAT: "VALIDATION",
  INTERNAL_ERROR: "UNKNOWN",
  NOT_FOUND: "NOT_FOUND",
  // Browser request codes (lib/api-request.ts)
  NETWORK_ERROR: "NETWORK",
  CLIENT_TIMEOUT: "TIMEOUT",
  BAD_RESPONSE: "UNKNOWN",
  CANCELLED: "UNKNOWN",
  // Storage (lib/db.ts → LocalStorageError.kind)
  UNAVAILABLE: "STORAGE",
  QUOTA_EXCEEDED: "STORAGE",
  FAILED: "STORAGE",
  // Extraction (lib/article-extractor.ts)
  NOT_HTML: "EXTRACTION",
  TOO_COMPLEX: "EXTRACTION",
  NO_ARTICLE_FOUND: "EXTRACTION",
  TOO_SHORT: "EXTRACTION",
  TOO_LARGE: "EXTRACTION",
  // Local AI (lib/ai/protocol.ts)
  UNSUPPORTED: "UNSUPPORTED",
  DOWNLOAD_FAILED: "LOCAL_AI",
  OUT_OF_MEMORY: "LOCAL_AI",
  WEBGPU_FAILED: "LOCAL_AI",
  MODEL_FAILED: "LOCAL_AI",
  INVALID_OUTPUT: "LOCAL_AI",
  INPUT_TOO_SHORT: "VALIDATION",
  WORKER_CRASHED: "LOCAL_AI",
};

/**
 * Turns ANY thrown value into a safe AppError. The raw message is never used,
 * because it may contain internals (paths, URLs, library details).
 */
export function toAppError(error: unknown): AppError {
  const code = errorCodeOf(error);
  return { code, message: APP_ERROR_MESSAGES[code], retryable: RETRYABLE.has(code) };
}

function errorCodeOf(error: unknown): AppErrorCode {
  if (error && typeof error === "object") {
    const record = error as { code?: unknown; kind?: unknown; name?: unknown };
    if (typeof record.code === "string") return toAppErrorCode(record.code);
    if (record.name === "LocalStorageError") return "STORAGE";
    if (typeof record.kind === "string") return toAppErrorCode(record.kind);
    if (record.name === "TimeoutError") return "TIMEOUT";
    if (record.name === "AbortError") return "TIMEOUT";
    if (record.name === "QuotaExceededError") return "STORAGE";
    if (record.name === "ChunkLoadError") return "NETWORK"; // app code could not be downloaded (offline / new version)
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "NETWORK";
  return "UNKNOWN";
}

// ---------------------------------------------------------------------------
// Redaction for logs
// ---------------------------------------------------------------------------

/**
 * Removes things that must never appear in logs: credentials and query strings
 * in URLs (they can hold tokens), absolute file paths, and long text (which
 * could be article content). Output is at most 200 characters.
 */
export function redact(text: string): string {
  return text
    .replace(/\b(https?:\/\/)[^/\s:@]+(:[^/\s@]*)?@/gi, "$1[credentials]@")
    // Bearer tokens first, then KEY=value secrets (env variables, connection strings).
    .replace(/\bBearer\s+[\w.~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|AUTH|CREDENTIAL|SESSION|COOKIE)[A-Z0-9_]*)\s*[=:]\s*(?!Bearer \[redacted\])\S+/gi, "$1=[redacted]")
    .replace(/(\bhttps?:\/\/[^\s?#"']+)[?#][^\s"']*/gi, "$1?[redacted]")
    // File paths, but not the path part of a URL (a path must start the text or follow a space/bracket).
    .replace(/(^|[\s(])(?:[A-Za-z]:\\|\/)(?:[\w.-]+[\\/])+[\w.-]+/g, "$1[path]")
    .replace(/\s+/g, " ")
    .slice(0, 200);
}

/** A short, safe description of an error for logs: name + redacted message, no stack. */
export function describeForLog(error: unknown): string {
  if (error instanceof Error) return redact(`${error.name}: ${error.message}`);
  if (typeof error === "string") return redact(error);
  return "non-error value thrown";
}
