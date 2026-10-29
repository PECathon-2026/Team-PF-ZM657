// Local browser database (IndexedDB) using Dexie.js.
// Runs in the BROWSER only. Data stays on this device and is never sent to the server.
//
// To look at the data: open browser DevTools → Application → IndexedDB → nova-reader.

import Dexie, { type EntityTable } from "dexie";
import type { ReadableArticle, SavedArticle } from "./feed-types";

class NovaDatabase extends Dexie {
  savedArticles!: EntityTable<SavedArticle, "id">;

  constructor() {
    super("nova-reader");
    // Version 1 of our schema. "id" is the primary key; "savedAt" is indexed
    // so we can sort by it. To change the schema later, add version(2).
    this.version(1).stores({
      savedArticles: "id, savedAt",
    });
  }
}

// Create the database only when first needed, and only in the browser.
// (During server rendering there is no IndexedDB.)
let database: NovaDatabase | undefined;

function getDb(): NovaDatabase {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    throw new LocalStorageError("Local storage is not available in this browser.");
  }
  database ??= new NovaDatabase();
  return database;
}

/** A friendly error for the UI. The original error is kept for debugging. */
export class LocalStorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LocalStorageError";
  }
}

/** Runs a database action and converts any failure into a LocalStorageError. */
async function safely<T>(action: () => Promise<T>, failMessage: string): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof LocalStorageError) throw error;
    console.error("[db]", error);
    throw new LocalStorageError(failMessage, { cause: error });
  }
}

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
