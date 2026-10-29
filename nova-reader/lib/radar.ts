// Personal Knowledge Radar calculations (Stage 8).
// Runs in the BROWSER, but is pure (no storage, no network, no React), so it
// is easy to test. Input: data already stored on this device. Output: a
// summary for the /radar page. Nothing here is saved or sent anywhere.
//
// Honesty rules:
//   - Only data that NOVA Reader really stores is used.
//   - Each number says what it is based on (e.g. "stored full articles").
//   - Things the app does not record are listed in `notAvailable`.

import type { CachedFeed, ExtractedArticle, SavedArticle } from "./feed-types";
import { htmlToText } from "./utils";

export type RadarInput = {
  saved: SavedArticle[];
  feeds: CachedFeed[];
  extracted: ExtractedArticle[];
  now: Date;
};

export type CountItem = { label: string; count: number };
export type TopicItem = CountItem & { kind: "category" | "keyword" };
export type WeekItem = { weekStart: string; label: string; count: number }; // weekStart = local date, YYYY-MM-DD

export type RadarReport = {
  generatedAt: string;
  isEmpty: boolean;
  totals: { savedArticles: number; sources: number; storedFeeds: number; fullArticles: number };
  topics: TopicItem[];
  sources: CountItem[];
  savedPerWeek: WeekItem[];
  depth: { fullArticles: number; totalWords: number; averageWords: number; estimatedMinutes: number } | null;
  languages: CountItem[];
  notAvailable: string[];
};

export const RADAR_LIMITS = {
  topics: 8,
  sources: 6, // more are folded into "Other"
  weeks: 8,
  wordsPerMinute: 200,
  minKeywordLength: 4,
} as const;

/** Builds the whole radar from local data. Pure and deterministic. */
export function buildRadar({ saved, feeds, extracted, now }: RadarInput): RadarReport {
  const extractedByUrl = new Map(extracted.map((article) => [stripHash(article.url), article]));
  const categoriesByUrl = categoryIndex(feeds);

  return {
    generatedAt: now.toISOString(),
    isEmpty: saved.length === 0 && extracted.length === 0,
    totals: {
      savedArticles: saved.length,
      sources: new Set(saved.map(sourceName)).size,
      storedFeeds: feeds.length,
      fullArticles: extracted.length,
    },
    topics: topicsOf(saved, categoriesByUrl, extractedByUrl),
    sources: topWithOther(countBy(saved, sourceName), RADAR_LIMITS.sources),
    savedPerWeek: perWeek(saved.map((article) => article.savedAt), now, RADAR_LIMITS.weeks),
    depth: readingDepth(extracted),
    languages: countBy(extracted.filter((a) => a.lang), (a) => languageName(a.lang!)),
    notAvailable: [
      "Local AI summaries — they are shown while the reader is open but are not stored.",
      "Reading time and a history of opened articles — NOVA Reader does not record them.",
      ...(saved.some((a) => !categoriesByUrl.has(stripHash(a.url)))
        ? ["Feed categories for saved articles whose feed is no longer cached (saving does not keep categories)."]
        : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** The feed title, or the website's host name if the title is missing. */
export function sourceName(article: Pick<SavedArticle, "feedTitle" | "url">): string {
  const title = article.feedTitle?.trim();
  if (title && title !== "Unknown feed") return title;
  try {
    return new URL(article.url).hostname.replace(/^www\./, "");
  } catch {
    return "Unknown source";
  }
}

// ---------------------------------------------------------------------------
// Topics: feed categories (when the feed is still cached) + frequent keywords
// ---------------------------------------------------------------------------

function categoryIndex(feeds: CachedFeed[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const feed of feeds) {
    for (const item of feed.items) {
      if (item.categories?.length) index.set(stripHash(item.url), item.categories);
    }
  }
  return index;
}

function topicsOf(
  saved: SavedArticle[],
  categoriesByUrl: Map<string, string[]>,
  extractedByUrl: Map<string, ExtractedArticle>,
): TopicItem[] {
  // Each topic counts the number of saved ARTICLES that mention it (not word
  // occurrences), so one long article cannot dominate the radar. An article
  // counts for a topic if it has it as a feed category OR as a keyword.
  const topics = new Map<string, { label: string; count: number; fromCategory: boolean }>();

  for (const article of saved) {
    const url = stripHash(article.url);
    const keys = new Map<string, { label: string; fromCategory: boolean }>();
    for (const category of categoriesByUrl.get(url) ?? []) {
      const key = category.trim().toLowerCase();
      if (key) keys.set(key, { label: category.trim(), fromCategory: true });
    }
    const fullText = extractedByUrl.get(url)?.contentHtml;
    const text = [article.title, article.summary, fullText ? htmlToText(fullText).slice(0, 20_000) : ""].join(" ");
    for (const word of keywordsOf(text)) {
      if (!keys.has(word)) keys.set(word, { label: capitalize(word), fromCategory: false });
    }
    for (const [key, { label, fromCategory }] of keys) {
      const entry = topics.get(key) ?? { label, count: 0, fromCategory: false };
      entry.count += 1;
      if (fromCategory && !entry.fromCategory) {
        entry.fromCategory = true;
        entry.label = label; // prefer the feed's own spelling
      }
      topics.set(key, entry);
    }
  }

  // With only a few saved articles every word appears once; ask for at least
  // two articles once there are enough, so single words do not look like trends.
  // Feed categories are always kept: the feed itself chose them.
  const minArticles = saved.length >= 5 ? 2 : 1;
  return [...topics.values()]
    .filter((topic) => topic.fromCategory || topic.count >= minArticles)
    .map((topic): TopicItem => ({ label: topic.label, count: topic.count, kind: topic.fromCategory ? "category" : "keyword" }))
    .sort((a, b) => b.count - a.count || (a.kind === b.kind ? 0 : a.kind === "category" ? -1 : 1) || a.label.localeCompare(b.label))
    .slice(0, RADAR_LIMITS.topics);
}

/** Lower-case words of at least 4 letters that are not common English words. */
export function keywordsOf(text: string): string[] {
  return (text.toLowerCase().match(/\p{L}[\p{L}'’-]*\p{L}/gu) ?? [])
    .map((word) => word.replace(/['’]s$/, ""))
    .filter((word) => word.length >= RADAR_LIMITS.minKeywordLength && !STOP_WORDS.has(word));
}

// A short English stop-word list plus common web/blog boilerplate.
const STOP_WORDS = new Set(
  (
    "about above after again against also although always among another anyone anything around because been before being below " +
    "between both cannot could does doing done down during each either else enough even ever every first from further getting " +
    "have having here hers herself himself however into itself just know last least less like made make makes making many " +
    "might more most much must myself near need never next none nothing often once only other others ought ours ourselves over " +
    "own perhaps quite rather really said same says shall should since some something still such than that their theirs them " +
    "themselves then there these they thing things think this those though through thus together under until upon very want " +
    "well were what whatever when where whether which while whom whose will with within without would year years your yours " +
    "yourself today yesterday tomorrow week weeks month months people time times true false like want using used uses use " +
    "article articles post posts blog read reading continue comments comment share click here link links http https html " +
    "newsletter subscribe email update updates video image photo source sources page site website online "
  ).split(/\s+/).filter(Boolean),
);

// ---------------------------------------------------------------------------
// Time, depth, languages
// ---------------------------------------------------------------------------

/** Articles saved per week for the last `weeks` weeks (weeks start on Monday, local time). */
export function perWeek(isoDates: string[], now: Date, weeks: number): WeekItem[] {
  const thisWeek = startOfWeek(now);
  const buckets: WeekItem[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(thisWeek);
    start.setDate(start.getDate() - i * 7);
    buckets.push({ weekStart: localDateKey(start), label: start.toLocaleDateString(undefined, { day: "numeric", month: "short" }), count: 0 });
  }
  const byKey = new Map(buckets.map((bucket) => [bucket.weekStart, bucket]));
  for (const iso of isoDates) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) continue;
    const bucket = byKey.get(localDateKey(startOfWeek(date)));
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

function localDateKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function readingDepth(extracted: ExtractedArticle[]): RadarReport["depth"] {
  if (extracted.length === 0) return null;
  const totalWords = extracted.reduce((sum, article) => sum + countWords(htmlToText(article.contentHtml)), 0);
  return {
    fullArticles: extracted.length,
    totalWords,
    averageWords: Math.round(totalWords / extracted.length),
    estimatedMinutes: Math.round(totalWords / RADAR_LIMITS.wordsPerMinute),
  };
}

export function countWords(text: string): number {
  return (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;
}

/** "en-US" → "English" (falls back to the code if the browser cannot name it). */
export function languageName(code: string): string {
  const primary = code.trim().split(/[-_]/)[0].toLowerCase();
  if (!/^[a-z]{2,3}$/.test(primary)) return "Unknown";
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(primary) ?? primary;
  } catch {
    return primary;
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function countBy<T>(items: T[], key: (item: T) => string): CountItem[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Keeps the top `limit` items and folds the rest into one "Other" item. */
export function topWithOther(items: CountItem[], limit: number): CountItem[] {
  if (items.length <= limit) return items;
  const rest = items.slice(limit).reduce((sum, item) => sum + item.count, 0);
  return [...items.slice(0, limit), { label: `Other (${items.length - limit})`, count: rest }];
}

function stripHash(url: string): string {
  return url.split("#")[0];
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
