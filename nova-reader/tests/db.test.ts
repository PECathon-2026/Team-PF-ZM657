// @vitest-environment jsdom
// Tests for lib/db.ts (IndexedDB via Dexie).
// fake-indexeddb gives jsdom a real, spec-following IndexedDB that lives in memory.
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cacheFeed,
  clearCachedFeeds,
  closeDatabase,
  countCachedFeeds,
  getCachedFeed,
  getLatestCachedFeed,
  getSavedArticles,
  LocalStorageError,
  MAX_CACHED_FEEDS,
  removeSavedArticle,
  saveArticle,
  toLocalStorageError,
} from "@/lib/db";
import type { FeedInfo, FeedItem } from "@/lib/feed-types";

const ARTICLE = {
  id: "feed1-post1",
  title: "Hello offline world",
  url: "https://blog.example/hello",
  summary: "A short summary.",
  contentHtml: '<p>Read <a href="https://blog.example/more">more</a></p>',
  author: "Asha",
  publishedAt: "2026-10-01T10:00:00.000Z",
};

const FEED: FeedInfo = { title: "Example Blog", feedUrl: "https://blog.example/feed.xml", siteUrl: "https://blog.example/" };
const ITEMS: FeedItem[] = [{ id: "i1", title: "Item 1", url: "https://blog.example/1", summary: "One" }];

/** Closing and reopening the database is what a page refresh does. */
function simulateRefresh() {
  closeDatabase();
}

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  closeDatabase();
  await Dexie.delete("nova-reader");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("saved articles", () => {
  it("saves, lists and removes articles", async () => {
    const saved = await saveArticle(ARTICLE, "Example Blog");
    expect(saved).toMatchObject({ ...ARTICLE, feedTitle: "Example Blog", savedAt: expect.any(String) });
    expect(await getSavedArticles()).toEqual([saved]);

    await removeSavedArticle(ARTICLE.id);
    expect(await getSavedArticles()).toEqual([]);
  });

  it("keeps saved articles after a refresh", async () => {
    await saveArticle(ARTICLE, "Example Blog");
    simulateRefresh();
    const [restored] = await getSavedArticles();
    expect(restored.title).toBe("Hello offline world");
    expect(restored.contentHtml).toContain('href="https://blog.example/more"'); // links survive offline
  });

  it("lists newest saved first and saving twice updates instead of duplicating", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    await saveArticle(ARTICLE, "Example Blog");
    vi.setSystemTime(new Date("2026-10-02T00:00:00Z"));
    await saveArticle({ ...ARTICLE, id: "other", title: "Second" }, "Example Blog");
    vi.setSystemTime(new Date("2026-10-03T00:00:00Z"));
    await saveArticle({ ...ARTICLE, title: "Hello again" }, "Example Blog");

    const list = await getSavedArticles();
    expect(list.map((a) => a.title)).toEqual(["Hello again", "Second"]);
  });

  it("removing an article that is not saved does nothing", async () => {
    await expect(removeSavedArticle("missing")).resolves.toBeUndefined();
  });
});

describe("offline feed copies", () => {
  it("stores and reads a feed copy by its requested URL", async () => {
    const stored = await cacheFeed("https://blog.example/rss", FEED, ITEMS);
    expect(await getCachedFeed("https://blog.example/rss")).toEqual(stored);
    expect(await getCachedFeed("https://other.example/rss")).toBeUndefined();
    expect(await countCachedFeeds()).toBe(1);
  });

  it("keeps copies after a refresh and returns the most recent one first", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    await cacheFeed("https://a.example/feed", { ...FEED, title: "A" }, ITEMS);
    vi.setSystemTime(new Date("2026-10-02T00:00:00Z"));
    await cacheFeed("https://b.example/feed", { ...FEED, title: "B" }, ITEMS);

    simulateRefresh();
    expect((await getLatestCachedFeed())?.feed.title).toBe("B");
  });

  it("replaces the copy when the same URL is loaded again", async () => {
    await cacheFeed("https://blog.example/rss", FEED, ITEMS);
    await cacheFeed("https://blog.example/rss", { ...FEED, title: "Renamed" }, []);
    expect(await countCachedFeeds()).toBe(1);
    expect((await getCachedFeed("https://blog.example/rss"))?.feed.title).toBe("Renamed");
  });

  it(`keeps only the newest ${MAX_CACHED_FEEDS} feeds`, async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let i = 0; i < MAX_CACHED_FEEDS + 3; i++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 1, 0, i)));
      await cacheFeed(`https://blog${i}.example/feed`, FEED, ITEMS);
    }
    expect(await countCachedFeeds()).toBe(MAX_CACHED_FEEDS);
    expect(await getCachedFeed("https://blog0.example/feed")).toBeUndefined(); // oldest removed
    expect(await getCachedFeed("https://blog2.example/feed")).toBeUndefined();
    expect(await getCachedFeed("https://blog3.example/feed")).toBeDefined();
    expect(await getCachedFeed(`https://blog${MAX_CACHED_FEEDS + 2}.example/feed`)).toBeDefined();
  });

  it("ignores corrupted or outdated records", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    await cacheFeed("https://good.example/feed", FEED, ITEMS);
    closeDatabase();

    // Write a broken record directly, as an old app version or DevTools might.
    const raw = new Dexie("nova-reader");
    raw.version(2).stores({ savedArticles: "id, savedAt", cachedFeeds: "requestedUrl, cachedAt" });
    await raw.table("cachedFeeds").put({ requestedUrl: "https://bad.example/feed", cachedAt: "2026-10-05T00:00:00.000Z", feed: "oops" });
    raw.close();

    expect(await getCachedFeed("https://bad.example/feed")).toBeUndefined();
    expect((await getLatestCachedFeed())?.requestedUrl).toBe("https://good.example/feed"); // skips the bad newest one
  });

  it("clearing offline copies keeps saved articles", async () => {
    await saveArticle(ARTICLE, "Example Blog");
    await cacheFeed("https://blog.example/rss", FEED, ITEMS);
    await clearCachedFeeds();
    expect(await countCachedFeeds()).toBe(0);
    expect(await getSavedArticles()).toHaveLength(1);
  });
});

describe("schema upgrade", () => {
  it("upgrades a version 1 database (Stage 4) without losing saved articles", async () => {
    const v1 = new Dexie("nova-reader");
    v1.version(1).stores({ savedArticles: "id, savedAt" });
    await v1.table("savedArticles").put({ ...ARTICLE, savedAt: "2026-09-01T00:00:00.000Z", feedTitle: "Old" });
    v1.close();

    expect((await getSavedArticles()).map((a) => a.title)).toEqual(["Hello offline world"]);
    await cacheFeed("https://blog.example/rss", FEED, ITEMS); // the new table exists after the upgrade
    expect(await countCachedFeeds()).toBe(1);
  });
});

describe("storage errors", () => {
  it("explains a full storage quota (including Dexie-wrapped errors)", () => {
    const direct = toLocalStorageError(new DOMException("full", "QuotaExceededError"), "Could not save.");
    const wrapped = toLocalStorageError({ name: "AbortError", inner: { name: "QuotaExceededError" } }, "Could not save.");
    for (const error of [direct, wrapped]) {
      expect(error).toBeInstanceOf(LocalStorageError);
      expect(error.kind).toBe("QUOTA_EXCEEDED");
      expect(error.message).toMatch(/storage for this site is full/);
    }
  });

  it("explains blocked storage and falls back to the given message otherwise", () => {
    expect(toLocalStorageError({ name: "SecurityError" }, "x").kind).toBe("UNAVAILABLE");
    const other = toLocalStorageError(new Error("disk on fire"), "Could not save this article on this device.");
    expect(other).toMatchObject({ kind: "FAILED", message: "Could not save this article on this device." });
    expect(other.message).not.toContain("disk on fire"); // raw error text is not shown to users
  });

  it("reports a clear error when IndexedDB is missing", async () => {
    closeDatabase();
    vi.stubGlobal("indexedDB", undefined);
    await expect(getSavedArticles()).rejects.toMatchObject({ name: "LocalStorageError", kind: "UNAVAILABLE" });
    await expect(cacheFeed("https://blog.example/rss", FEED, ITEMS)).rejects.toMatchObject({ kind: "UNAVAILABLE" });
  });

  it("never sends saved data to the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await saveArticle(ARTICLE, "Example Blog");
    await cacheFeed("https://blog.example/rss", FEED, ITEMS);
    await getSavedArticles();
    await getLatestCachedFeed();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
