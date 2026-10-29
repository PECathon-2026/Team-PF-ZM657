// Input validation with Zod.
// Runs on BOTH sides:
//   - Browser: FeedForm checks the URL before sending it, for a fast error message.
//   - Server:  the API route checks it again, because browser checks can be bypassed.

import { z } from "zod";
import { API_ERROR_CODES, type ApiErrorCode } from "./feed-types";

export const MAX_URL_LENGTH = 2048;

export type UrlValidationResult =
  | { ok: true; url: string }
  | { ok: false; code: ApiErrorCode; message: string };

/**
 * Basic check for hostnames that point at the server itself or a private network.
 *
 * MVP ONLY: this checks the text of the hostname. It does NOT resolve DNS, so a
 * public domain that points to a private IP (or "DNS rebinding") is not caught.
 * Production needs DNS-level SSRF protection. See README → Security limitations.
 */
export function isBlockedHostname(hostname: string): boolean {
  // URL keeps IPv6 addresses in brackets, e.g. "[::1]".
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");

  if (host === "" || host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) return true;

  if (isIPv4(host)) return isPrivateIPv4(host);
  if (host.includes(":")) return isPrivateIPv6(host);
  return false;
}

function isIPv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function isPrivateIPv4(host: string): boolean {
  const [a, b] = host.split(".").map(Number);
  return (
    a === 0 || // "this network"
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, includes cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    a >= 224 // multicast and reserved
  );
}

function isPrivateIPv6(host: string): boolean {
  if (host === "::" || host === "::1") return true;
  // IPv4 written inside IPv6, e.g. "::ffff:127.0.0.1" or "::ffff:7f00:1"
  if (host.startsWith("::ffff:")) return true;
  return (
    host.startsWith("fc") || // unique local fc00::/7
    host.startsWith("fd") ||
    host.startsWith("fe8") || // link-local fe80::/10
    host.startsWith("fe9") ||
    host.startsWith("fea") ||
    host.startsWith("feb")
  );
}

// The Zod schema only checks "is this a non-empty, reasonably short string?".
// The URL-specific checks below give clearer error codes than one big schema.
const feedUrlInputSchema = z
  .string({ error: "Please enter a feed URL." })
  .trim()
  .min(1, "Please enter a feed URL.")
  .max(MAX_URL_LENGTH, "This URL is too long.");

/**
 * Checks a feed URL typed by the user.
 * Returns { ok: true, url } with a cleaned-up URL, or { ok: false, code, message }.
 * Never throws, whatever the input (including non-strings).
 *
 * Rules: trimmed, not empty, at most 2048 characters, a real URL, http: or https:
 * only (so file:, ftp:, javascript:, data:, blob: … are rejected), no
 * "user:password@", and not localhost / loopback / private-network hostnames.
 *
 * IMPORTANT: this is BASIC MVP validation, NOT complete production SSRF
 * protection. It checks the URL text only; it does not resolve DNS, so a public
 * domain pointing at a private IP is not detected.
 */
export function validateFeedUrl(input: unknown): UrlValidationResult {
  const parsed = feedUrlInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_URL", message: parsed.error.issues[0]?.message ?? "Invalid URL." };
  }

  let url: URL;
  try {
    url = new URL(parsed.data);
  } catch {
    return {
      ok: false,
      code: "INVALID_URL",
      message: "This is not a valid URL. It should look like https://example.com/feed.xml",
    };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, code: "UNSUPPORTED_PROTOCOL", message: "Only http:// and https:// URLs are supported." };
  }

  if (url.username || url.password) {
    return { ok: false, code: "INVALID_URL", message: "URLs with a username or password are not allowed." };
  }

  if (isBlockedHostname(url.hostname)) {
    return {
      ok: false,
      code: "BLOCKED_HOST",
      message: "Local and private network addresses are not allowed.",
    };
  }

  // Remove "#section" parts, the server never receives them anyway.
  url.hash = "";
  return { ok: true, url: url.toString() };
}

// ---------------------------------------------------------------------------
// Schema for the API response. The browser uses it to check that the JSON it
// received really has the shape we expect before showing it.
// ---------------------------------------------------------------------------

const feedItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  summary: z.string(),
  contentHtml: z.string().optional(),
  author: z.string().optional(),
  publishedAt: z.string().optional(),
  updatedAt: z.string().optional(),
  imageUrl: z.string().optional(),
  categories: z.array(z.string()).optional(),
});

export const feedApiResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    feed: z.object({
      title: z.string(),
      description: z.string().optional(),
      siteUrl: z.string().optional(),
      feedUrl: z.string(),
    }),
    items: z.array(feedItemSchema),
  }),
  z.object({
    success: z.literal(false),
    error: z.object({
      code: z.enum(API_ERROR_CODES),
      message: z.string(),
    }),
  }),
]);
