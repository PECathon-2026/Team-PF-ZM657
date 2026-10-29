// Tests for lib/radar.ts (Stage 8). Pure calculations on local data — no DB, no network.
import { describe, expect, it } from "vitest";
import type { CachedFeed, ExtractedArticle, SavedArticle } from "@/lib/feed-types";
import { buildRadar, countWords, keywordsOf, languageName, perWeek, RADAR_LIMITS, sourceName, topWithOther } from "@/lib/radar";

// Local-time dates, so the week tests do not depend on the machine's time zone.
const NOW = new Date(2026, 9, 29, 12, 0); // Thursday 29 Oct 2026
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 10).toISOString();

function saved(id: string, overrides: Partial<SavedArticle> = {}): SavedArticle {
  return {
    id,
    title: `Article ${id}`,
    url: `https://blog.example/${id}`,
    summary: "",
    savedAt: day(2026, 10, 28),
    feedTitle: "Example Blog",
    ...overrides,
  };
}

function extracted(url: string, words: number, lang?: string): ExtractedArticle {
  return {
    url,
    pageUrl: url,
    contentHtml: `<p>${"word ".repeat(words)}</p>`,
    textLength: words * 5,
    extractedAt: day(2026, 10, 27),
    lang,
  };
}

const feedWithCategories: CachedFeed = {
  requestedUrl: "https://blog.example/feed.xml",
  feed: { title: "Example Blog", feedUrl: "https://blog.example/feed.xml" },
  items: [
    { id: "1", title: "a", url: "https://blog.example/a", summary: "", categories: ["Privacy", "Open Web"] },
    { id: "2", title: "b", url: "https://blog.example/b", summary: "", categories: ["privacy"] },
  ],
  cachedAt: day(2026, 10, 28),
};

describe("buildRadar – totals and empty state", () => {
  it("is empty when nothing is stored", () => {
    const report = buildRadar({ saved: [], feeds: [], extracted: [], now: NOW });
    expect(report.isEmpty).toBe(true);
    expect(report.totals).toEqual({ savedArticles: 0, sources: 0, storedFeeds: 0, fullArticles: 0 });
    expect(report.topics).toEqual([]);
    expect(report.depth).toBeNull();
  });

  it("counts only what is stored", () => {
    const report = buildRadar({
      saved: [saved("a"), saved("b"), saved("c", { feedTitle: "Other Blog" })],
      feeds: [feedWithCategories],
      extracted: [extracted("https://blog.example/a", 400)],
      now: NOW,
    });
    expect(report.totals).toEqual({ savedArticles: 3, sources: 2, storedFeeds: 1, fullArticles: 1 });
    expect(report.generatedAt).toBe(NOW.toISOString());
  });

  it("does not change its inputs and gives the same result twice", () => {
    const input = { saved: [saved("a"), saved("b")], feeds: [feedWithCategories], extracted: [extracted("https://blog.example/a", 10)], now: NOW };
    const copy = structuredClone(input);
    expect(buildRadar(input)).toEqual(buildRadar(input));
    expect(input).toEqual(copy);
  });
});

describe("buildRadar – topics", () => {
  it("uses feed categories for saved articles while their feed is cached (case-insensitive)", () => {
    const report = buildRadar({ saved: [saved("a"), saved("b")], feeds: [feedWithCategories], extracted: [], now: NOW });
    expect(report.topics[0]).toEqual({ label: "Privacy", count: 2, kind: "category" });
    expect(report.topics).toContainEqual({ label: "Open Web", count: 1, kind: "category" });
  });

  it("counts an article once for a topic whether it is a category or only a keyword", () => {
    const report = buildRadar({
      saved: [saved("a"), saved("b"), saved("c", { summary: "Thoughts on privacy tools" })],
      feeds: [feedWithCategories],
      extracted: [],
      now: NOW,
    });
    expect(report.topics[0]).toEqual({ label: "Privacy", count: 3, kind: "category" });
  });

  it("counts articles, not word repetitions", () => {
    const report = buildRadar({
      saved: [
        saved("a", { title: "Solar solar solar solar power" }),
        saved("b", { title: "Gardening notes" }),
      ],
      feeds: [],
      extracted: [],
      now: NOW,
    });
    expect(report.topics.find((t) => t.label === "Solar")).toEqual({ label: "Solar", count: 1, kind: "keyword" });
  });

  it("uses titles, summaries and stored full text", () => {
    const report = buildRadar({
      saved: [saved("a", { title: "Hello", summary: "Notes about beekeeping" }), saved("b", { title: "Hi" })],
      feeds: [],
      extracted: [{ ...extracted("https://blog.example/b", 0), contentHtml: "<p>More beekeeping tips</p>" }],
      now: NOW,
    });
    expect(report.topics[0]).toEqual({ label: "Beekeeping", count: 2, kind: "keyword" });
  });

  it("needs a keyword in at least two articles once five or more are saved", () => {
    const many = ["Rust compilers", "Rust tooling", "Gardening", "Cooking rice", "Birdwatching"].map((title, i) => saved(String(i), { title }));
    const labels = buildRadar({ saved: many, feeds: [], extracted: [], now: NOW }).topics.map((t) => t.label);
    expect(labels).toEqual(["Rust"]);
  });

  it(`keeps at most ${RADAR_LIMITS.topics} topics`, () => {
    const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"];
    const report = buildRadar({ saved: [saved("a", { title: words.join(" ") })], feeds: [], extracted: [], now: NOW });
    expect(report.topics).toHaveLength(RADAR_LIMITS.topics);
  });

  it("does not invent topics when only full articles (no saved articles) exist", () => {
    const report = buildRadar({ saved: [], feeds: [], extracted: [extracted("https://x.example/a", 50)], now: NOW });
    expect(report.isEmpty).toBe(false);
    expect(report.topics).toEqual([]);
    expect(report.sources).toEqual([]);
  });
});

describe("keywordsOf", () => {
  it("keeps meaningful words and drops common words, short words and numbers", () => {
    expect(keywordsOf("The new privacy rules for 2026 would really change the open web, it's said")).toEqual(["privacy", "rules", "change", "open"]);
  });

  it("handles accents and other alphabets", () => {
    expect(keywordsOf("Café culture in Zürich and Москва")).toEqual(["café", "culture", "zürich", "москва"]);
  });
});

describe("sources", () => {
  it("uses the feed title, or the host name when it is missing", () => {
    expect(sourceName({ feedTitle: "Example Blog", url: "https://x.example/a" })).toBe("Example Blog");
    expect(sourceName({ feedTitle: "Unknown feed", url: "https://www.news.example/a" })).toBe("news.example");
    expect(sourceName({ feedTitle: "", url: "not a url" })).toBe("Unknown source");
  });

  it("folds the tail into Other", () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ label: `S${i}`, count: 9 - i }));
    const result = topWithOther(items, 6);
    expect(result).toHaveLength(7);
    expect(result[6]).toEqual({ label: "Other (3)", count: 3 + 2 + 1 });
  });
});

describe("perWeek", () => {
  it("groups saves into the last 8 weeks starting on Monday", () => {
    const weeks = perWeek(
      [day(2026, 10, 26), day(2026, 10, 29), day(2026, 10, 25), day(2026, 9, 7), day(2025, 1, 1), "not a date"],
      NOW,
      8,
    );
    expect(weeks).toHaveLength(8);
    expect(weeks[7]).toMatchObject({ weekStart: "2026-10-26", count: 2 }); // Mon 26 + Thu 29
    expect(weeks[6]).toMatchObject({ weekStart: "2026-10-19", count: 1 }); // Sun 25 belongs to the previous week
    expect(weeks[0]).toMatchObject({ weekStart: "2026-09-07", count: 1 });
    expect(weeks.reduce((sum, w) => sum + w.count, 0)).toBe(4); // too old and invalid dates are ignored
  });
});

describe("reading depth and languages", () => {
  it("counts words in stored full articles and estimates minutes at 200 wpm", () => {
    const report = buildRadar({
      saved: [],
      feeds: [],
      extracted: [extracted("https://x.example/a", 400), extracted("https://x.example/b", 200)],
      now: NOW,
    });
    expect(report.depth).toEqual({ fullArticles: 2, totalWords: 600, averageWords: 300, estimatedMinutes: 3 });
  });

  it("names languages and groups regional variants", () => {
    const report = buildRadar({
      saved: [],
      feeds: [],
      extracted: [extracted("https://x.example/a", 1, "en-US"), extracted("https://x.example/b", 1, "en"), extracted("https://x.example/c", 1, "hi")],
      now: NOW,
    });
    expect(report.languages).toEqual([
      { label: "English", count: 2 },
      { label: "Hindi", count: 1 },
    ]);
    expect(languageName("!!")).toBe("Unknown");
  });

  it("counts words sensibly", () => {
    expect(countWords("It's a well-known fact: 3 feeds, 2 blogs.")).toBe(8); // It's · a · well-known · fact · 3 · feeds · 2 · blogs
  });
});

describe("notAvailable", () => {
  it("always says that AI summaries and reading time are not stored", () => {
    const notes = buildRadar({ saved: [saved("a")], feeds: [feedWithCategories], extracted: [], now: NOW }).notAvailable;
    expect(notes.join(" ")).toMatch(/AI summaries/);
    expect(notes.join(" ")).toMatch(/Reading time/);
  });

  it("mentions missing categories only when a saved article's feed is not cached", () => {
    const withFeed = buildRadar({ saved: [saved("a")], feeds: [feedWithCategories], extracted: [], now: NOW }).notAvailable;
    const withoutFeed = buildRadar({ saved: [saved("zzz")], feeds: [feedWithCategories], extracted: [], now: NOW }).notAvailable;
    expect(withFeed.some((n) => n.includes("categories"))).toBe(false);
    expect(withoutFeed.some((n) => n.includes("categories"))).toBe(true);
  });
});
