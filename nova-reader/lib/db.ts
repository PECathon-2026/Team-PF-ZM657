// Local browser database (IndexedDB) using Dexie.js.
// Runs in the BROWSER only. Data stays on this device and is never sent to the server.
//
// Tables:
//   savedArticles – articles the user pressed "Save" on (kept until removed)
//   cachedFeeds   – offline copies of the last few feeds loaded (max 10)
//   extractedArticles – readable full articles (Stage 6), max 50, but the
//                       full text of SAVED articles is never deleted automatically
//
// To look at the data: open browser DevTools → Application → IndexedDB → nova-reader.

import Dexie, { type EntityTable } from "dexie";
import "./zod-setup";
import * as z from "zod";
import type { CachedFeed, ExtractedArticle, FeedInfo, FeedItem, ReadableArticle, SavedArticle } from "./feed-types";
import { logError } from "./log";
import { feedInfoSchema, feedItemSchema } from "./validation";

/** How many feeds keep an offline copy. Older copies are deleted first. */
export const MAX_CACHED_FEEDS = 10;

/** How many extracted full articles are kept (not counting saved articles). */
export const MAX_EXTRACTED_ARTICLES = 50;

class NovaDatabase extends Dexie {
  savedArticles!: EntityTable<SavedArticle, "id">;
  cachedFeeds!: EntityTable<CachedFeed, "requestedUrl">;
  extractedArticles!: EntityTable<ExtractedArticle, "url">;

  constructor() {
    super("nova-reader");
    // Version 1: saved articles. "id" is the primary key; "savedAt" is indexed for sorting.
    this.version(1).stores({
      savedArticles: "id, savedAt",
    });
    // Version 2 (Stage 5): adds offline feed copies. Dexie upgrades existing
    // databases automatically and keeps everything already in savedArticles.
    this.version(2).stores({
      savedArticles: "id, savedAt",
      cachedFeeds: "requestedUrl, cachedAt",
    });
    // Version 3 (Stage 6): readable full articles, keyed by article URL.
    // savedArticles gets a "url" index so we can tell which full articles belong
    // to saved articles (those are never removed automatically).
    this.version(3).stores({
      savedArticles: "id, savedAt, url",
      cachedFeeds: "requestedUrl, cachedAt",
      extractedArticles: "url, extractedAt",
    });
  }
}

// Create the database only when first needed, and only in the browser.
// (During server rendering there is no IndexedDB.)
let database: NovaDatabase | undefined;

function getDb(): NovaDatabase {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    throw new LocalStorageError("Local storage is not available in this browser.", "UNAVAILABLE");
  }
  database ??= new NovaDatabase();
  return database;
}

/** Closes the connection (used by tests to simulate a page refresh). */
export function closeDatabase(): void {
  database?.close();
  database = undefined;
}

export type LocalStorageErrorKind = "UNAVAILABLE" | "QUOTA_EXCEEDED" | "FAILED";

/** A friendly error for the UI. The original error is kept in `cause` for debugging. */
export class LocalStorageError extends Error {
  constructor(
    message: string,
    public readonly kind: LocalStorageErrorKind = "FAILED",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LocalStorageError";
  }
}

/** Runs a database action and converts any failure into a LocalStorageError. */
async function safely<T>(action: () => Promise<T>, failMessage: string): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof LocalStorageError)) logError("db", error);
    throw toLocalStorageError(error, failMessage);
  }
}

/**
 * Turns any storage error into a LocalStorageError with a message people can act on.
 * "Storage full" and "storage blocked" get their own messages.
 */
export function toLocalStorageError(error: unknown, failMessage: string): LocalStorageError {
  if (error instanceof LocalStorageError) return error;
  if (isQuotaError(error)) {
    return new LocalStorageError(
      "Your browser's storage for this site is full. Remove some saved articles or clear offline copies.",
      "QUOTA_EXCEEDED",
      { cause: error },
    );
  }
  if (isUnavailableError(error)) {
    return new LocalStorageError(
      "This browser is blocking local storage (private browsing can do this). Saving and offline copies will not work.",
      "UNAVAILABLE",
      { cause: error },
    );
  }
  return new LocalStorageError(failMessage, "FAILED", { cause: error });
}

/** Dexie wraps browser errors; the original name can be on the error or its `inner` error. */
function errorNames(error: unknown): string[] {
  const names: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth++) {
    const name = (current as { name?: unknown }).name;
    if (typeof name === "string") names.push(name);
    current = (current as { inner?: unknown }).inner;
  }
  return names;
}

function isQuotaError(error: unknown): boolean {
  return errorNames(error).some((name) => name === "QuotaExceededError" || name === "QuotaExceeded");
}

function isUnavailableError(error: unknown): boolean {
  return errorNames(error).some((name) => ["MissingAPIError", "InvalidStateError", "SecurityError"].includes(name));
}

// ---------------------------------------------------------------------------
// Saved articles
// ---------------------------------------------------------------------------

/** Returns all saved articles, newest saved first. */
export function getSavedArticles(): Promise<SavedArticle[]> {
  return safely(
    () => getDb().savedArticles.orderBy("savedAt").reverse().toArray(),
    "Could not load saved articles. Private browsing mode can block local storage.",
  );
}

/** Saves one article from a feed. Saving the same article twice just updates it. */
export async function saveArticle(item: ReadableArticle, feedTitle: string): Promise<SavedArticle> {
  const article: SavedArticle = {
    id: item.id,
    title: item.title,
    url: item.url,
    summary: item.summary,
    contentHtml: item.contentHtml, // kept so links still work offline
    author: item.author,
    publishedAt: item.publishedAt,
    savedAt: new Date().toISOString(),
    feedTitle,
  };
  await safely(() => getDb().savedArticles.put(article), "Could not save this article on this device.");
  return article;
}

/** Deletes a saved article by its ID. Does nothing if it was not saved. */
export function removeSavedArticle(id: string): Promise<void> {
  return safely(() => getDb().savedArticles.delete(id), "Could not remove this article.");
}

// ---------------------------------------------------------------------------
// Offline feed copies
// ---------------------------------------------------------------------------

// Data read back from IndexedDB is checked before use: it may come from an
// older app version or have been edited in DevTools.
const cachedFeedSchema = z.object({
  requestedUrl: z.string(),
  feed: feedInfoSchema,
  items: z.array(feedItemSchema),
  cachedAt: z.string(),
});

function toValidCachedFeed(record: unknown): CachedFeed | undefined {
  const parsed = cachedFeedSchema.safeParse(record);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Stores (or replaces) the offline copy of a feed, then deletes the oldest
 * copies so at most MAX_CACHED_FEEDS remain.
 */
export async function cacheFeed(requestedUrl: string, feed: FeedInfo, items: FeedItem[]): Promise<CachedFeed> {
  const record: CachedFeed = { requestedUrl, feed, items, cachedAt: new Date().toISOString() };
  await safely(async () => {
    const db = getDb();
    await db.transaction("rw", db.cachedFeeds, async () => {
      await db.cachedFeeds.put(record);
      const count = await db.cachedFeeds.count();
      if (count > MAX_CACHED_FEEDS) {
        const oldest = await db.cachedFeeds.orderBy("cachedAt").limit(count - MAX_CACHED_FEEDS).primaryKeys();
        await db.cachedFeeds.bulkDelete(oldest);
      }
    });
  }, "Could not keep an offline copy of this feed.");
  return record;
}

/** The offline copy for one URL, or undefined if there is none (or it is invalid). */
export async function getCachedFeed(requestedUrl: string): Promise<CachedFeed | undefined> {
  const record = await safely(() => getDb().cachedFeeds.get(requestedUrl), "Could not read the offline copy.");
  return toValidCachedFeed(record);
}

/** The most recently stored valid offline copy, used when the page opens. */
export async function getLatestCachedFeed(): Promise<CachedFeed | undefined> {
  const records = await safely(
    () => getDb().cachedFeeds.orderBy("cachedAt").reverse().toArray(),
    "Could not read offline copies.",
  );
  for (const record of records) {
    const valid = toValidCachedFeed(record);
    if (valid) return valid;
  }
  return undefined;
}

/** All valid offline feed copies, newest first (read-only; used by the radar). */
export async function listCachedFeeds(): Promise<CachedFeed[]> {
  const records = await safely(
    () => getDb().cachedFeeds.orderBy("cachedAt").reverse().toArray(),
    "Could not read offline copies.",
  );
  return records.map(toValidCachedFeed).filter((feed): feed is CachedFeed => feed !== undefined);
}

/** Number of offline feed copies stored. */
export function countCachedFeeds(): Promise<number> {
  return safely(() => getDb().cachedFeeds.count(), "Could not read offline copies.");
}

/** Deletes every offline feed copy. Saved articles are NOT touched. */
export function clearCachedFeeds(): Promise<void> {
  return safely(() => getDb().cachedFeeds.clear(), "Could not clear offline copies.");
}

// ---------------------------------------------------------------------------
// Extracted full articles (Stage 6)
// ---------------------------------------------------------------------------

const extractedArticleSchema = z.object({
  url: z.string(),
  pageUrl: z.string(),
  title: z.string().optional(),
  byline: z.string().optional(),
  siteName: z.string().optional(),
  excerpt: z.string().optional(),
  lang: z.string().optional(),
  publishedTime: z.string().optional(),
  contentHtml: z.string(),
  textLength: z.number(),
  extractedAt: z.string(),
});

/** The stored readable version of an article, or undefined (also for invalid records). */
export async function getExtractedArticle(url: string): Promise<ExtractedArticle | undefined> {
  const record = await safely(() => getDb().extractedArticles.get(url), "Could not read the stored article.");
  const parsed = extractedArticleSchema.safeParse(record);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Stores a readable article for offline reading. Keeps at most
 * MAX_EXTRACTED_ARTICLES, deleting the oldest first — but never the full text
 * of an article that is in savedArticles.
 */
export async function storeExtractedArticle(article: ExtractedArticle): Promise<void> {
  await safely(async () => {
    const db = getDb();
    await db.transaction("rw", db.extractedArticles, db.savedArticles, async () => {
      await db.extractedArticles.put(article);
      const savedUrls = new Set((await db.savedArticles.orderBy("url").uniqueKeys()).map(String));
      const removable = (await db.extractedArticles.orderBy("extractedAt").primaryKeys()).filter(
        (url) => !savedUrls.has(String(url)),
      );
      const excess = removable.length - MAX_EXTRACTED_ARTICLES;
      if (excess > 0) await db.extractedArticles.bulkDelete(removable.slice(0, excess));
    });
  }, "Could not keep this article for offline reading.");
}

/** Number of stored readable articles. */
export function countExtractedArticles(): Promise<number> {
  return safely(() => getDb().extractedArticles.count(), "Could not read stored articles.");
}

/**
 * "Clear offline copies": deletes all feed copies and every stored full article
 * that does NOT belong to a saved article. Saved articles are kept, with their full text.
 */
export async function clearOfflineCopies(): Promise<void> {
  await safely(async () => {
    const db = getDb();
    await db.transaction("rw", db.cachedFeeds, db.extractedArticles, db.savedArticles, async () => {
      await db.cachedFeeds.clear();
      const savedUrls = (await db.savedArticles.orderBy("url").uniqueKeys()).map(String);
      await db.extractedArticles.where("url").noneOf(savedUrls).delete();
    });
  }, "Could not clear offline copies.");
}

/** All valid stored full articles, newest first (read-only; used by the radar). */
export async function listExtractedArticles(): Promise<ExtractedArticle[]> {
  const records = await safely(
    () => getDb().extractedArticles.orderBy("extractedAt").reverse().toArray(),
    "Could not read stored articles.",
  );
  return records
    .map((record) => extractedArticleSchema.safeParse(record))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data as ExtractedArticle);
}
