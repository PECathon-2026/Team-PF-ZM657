// Shared TypeScript types for NOVA Reader.
// Used by BOTH the server (API route, parser) and the browser (components, database).
// This file contains only types and constants, so it is safe to import anywhere.

/** One article (post) inside a feed, after RSS/Atom has been normalized. */
export type FeedItem = {
  id: string;
  title: string;
  url: string;
  summary: string;
  /**
   * The article HTML exactly as the feed sent it (UNTRUSTED, not sanitized).
   * Only present when the feed content contains HTML tags. It keeps links that
   * `summary` (plain text) loses. Must go through lib/sanitize-html.ts before
   * it is shown.
   */
  contentHtml?: string;
  author?: string;
  publishedAt?: string; // ISO 8601 date string, e.g. "2026-10-29T10:00:00.000Z"
  imageUrl?: string;
};

/** A whole feed (one blog), after RSS/Atom has been normalized. */
export type Feed = {
  title: string;
  description?: string;
  siteUrl?: string;
  feedUrl: string;
  items: FeedItem[];
};

/** Feed details without the items. This is the `feed` object the API returns. */
export type FeedInfo = Omit<Feed, "items">;

/** Every error code the API can return. The browser can show a message per code. */
export const API_ERROR_CODES = [
  "INVALID_URL",
  "UNSUPPORTED_PROTOCOL",
  "BLOCKED_HOST",
  "TOO_MANY_REDIRECTS",
  "TIMEOUT",
  "FETCH_FAILED",
  "UPSTREAM_ERROR",
  "RESPONSE_TOO_LARGE",
  "INVALID_XML",
  "UNSUPPORTED_FORMAT",
  "INTERNAL_ERROR",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export type ApiError = {
  code: ApiErrorCode;
  message: string;
};

/** Shape of a successful GET /api/feed response. */
export type FeedApiSuccess = {
  success: true;
  feed: FeedInfo;
  items: FeedItem[];
};

/** Shape of a failed GET /api/feed response. */
export type FeedApiFailure = {
  success: false;
  error: ApiError;
};

export type FeedApiResponse = FeedApiSuccess | FeedApiFailure;

/** An article the user saved. Stored only in the browser (IndexedDB). */
export type SavedArticle = {
  id: string;
  title: string;
  url: string;
  summary: string;
  contentHtml?: string; // untrusted feed HTML, sanitized only when displayed
  author?: string;
  publishedAt?: string;
  savedAt: string; // ISO date of when the user pressed "Save"
  feedTitle: string;
};

/** The fields the UI needs to show or read an article. Both FeedItem and SavedArticle fit. */
export type ReadableArticle = Pick<FeedItem, "id" | "title" | "url" | "summary" | "contentHtml" | "author" | "publishedAt"> & {
  feedTitle?: string;
};

/** Maximum number of articles the parser returns for one feed. */
export const MAX_FEED_ITEMS = 50;
