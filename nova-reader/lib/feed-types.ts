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
  updatedAt?: string; // ISO 8601, when the feed says the article was last changed
  imageUrl?: string;
  categories?: string[]; // tags/topics, max 20, only present when the feed has some
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
  "UNSUPPORTED_CONTENT_TYPE",
  "RATE_LIMITED",
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

/**
 * Shape of a successful GET /api/article response (Stage 6).
 * `html` is the RAW, UNTRUSTED page. The browser extracts the article with
 * Readability and sanitizes it with DOMPurify before anything is shown.
 */
export type ArticlePageApiSuccess = {
  success: true;
  page: {
    url: string; // final URL after redirects; relative links are resolved against it
    html: string;
  };
};

export type ArticlePageApiResponse = ArticlePageApiSuccess | FeedApiFailure;

/** A readable article extracted in the browser (Stage 6). `contentHtml` is UNSANITIZED. */
export type ExtractedArticle = {
  url: string; // the article URL from the feed (the lookup key)
  pageUrl: string; // final page URL, base for relative links
  title?: string;
  byline?: string;
  siteName?: string;
  excerpt?: string;
  lang?: string;
  publishedTime?: string;
  contentHtml: string; // Readability output; sanitized every time it is displayed
  textLength: number;
  extractedAt: string; // ISO date
};

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

/**
 * An offline copy of a feed, stored only in this browser (IndexedDB).
 * `requestedUrl` is the URL the user typed (after validation); it is the key,
 * so "load this URL again" finds the copy even if the feed redirected.
 */
export type CachedFeed = {
  requestedUrl: string;
  feed: FeedInfo;
  items: FeedItem[];
  cachedAt: string; // ISO date of when this copy was stored
};

/** The fields the UI needs to show or read an article. Both FeedItem and SavedArticle fit. */
export type ReadableArticle = Pick<FeedItem, "id" | "title" | "url" | "summary" | "contentHtml" | "author" | "publishedAt"> & {
  feedTitle?: string;
};

/** Optional settings for parseFeedXml(). Defaults are the limits below. */
export type ParserOptions = {
  /** Maximum articles to return (1–50). Default 50. */
  maxItems?: number;
};

/** Size limits applied by the parser. Feeds are untrusted, so nothing is unbounded. */
export const FEED_LIMITS = {
  maxXmlBytes: 2 * 1024 * 1024, // 2 MB
  maxItems: 50,
  maxTitleLength: 500,
  maxDescriptionLength: 1_000,
  maxSummaryLength: 10_000,
  maxAuthorLength: 300,
  maxCategories: 20,
  maxCategoryLength: 100,
  maxContentHtmlLength: 200_000,
} as const;

/** Maximum number of articles the parser returns for one feed. */
export const MAX_FEED_ITEMS = FEED_LIMITS.maxItems;
