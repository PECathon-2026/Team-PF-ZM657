// Small, pure helper functions used by the parser and the UI.
// Runs on BOTH server and browser. No network, no storage, no side effects.

/**
 * Turns any string into a short, stable ID.
 * The same input always gives the same output (FNV-1a hash).
 * Not for security, only for creating repeatable IDs.
 */
export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // >>> 0 makes the number positive; base 36 keeps it short.
  return (hash >>> 0).toString(36);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
};

/** Converts HTML entities like "&amp;" or "&#8217;" into normal characters. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const isHex = entity[1].toLowerCase() === "x";
      const code = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      // Ignore invalid or out-of-range code points instead of crashing.
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Converts an HTML snippet into PLAIN TEXT.
 * Removes all tags, scripts and styles, keeps paragraph breaks.
 * The result is rendered by React as text, so it can never run as code.
 */
export function htmlToText(html: string): string {
  // In real HTML, a raw line break is just a space; only tags like <p> or <br>
  // create new lines. Plain text (no tags) keeps its own line breaks.
  const looksLikeHtml = /<[a-z!/][^>]*>/i.test(html);
  const source = looksLikeHtml ? html.replace(/\s+/g, " ") : html;

  const text = source
    // Drop whole blocks whose content should never be shown.
    .replace(/<(script|style|iframe|noscript|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Turn block-level endings into line breaks so paragraphs survive.
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|pre|tr|section|article)>/gi, "\n\n")
    .replace(/<\/(td|th)>/gi, " ") // keep table cells apart
    // Remove every remaining (inline) tag. No space is added, because inline
    // tags like <a> or <em> do not create space: "<a>here</a>." → "here."
    .replace(/<[^>]*>/g, "");

  return decodeHtmlEntities(text)
    .replace(/\r\n?/g, "\n") // Windows/old Mac line endings → \n
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "") // invisible zero-width characters
    .replace(/[^\S\n]+/g, " ") // every other kind of whitespace → one space
    .replace(/ *\n */g, "\n") // trim spaces around line breaks
    .replace(/\n{3,}/g, "\n\n") // at most one blank line
    .trim();
}

/**
 * Shortens text to at most `maxLength` characters and adds "…" if it was cut.
 * A limit below 1 (or NaN) gives "", because there is no room for any text.
 * Fractional limits are rounded down.
 */
export function truncate(text: string, maxLength: number): string {
  const limit = Math.floor(maxLength);
  if (!(limit >= 1)) return ""; // also catches NaN
  if (text.length <= limit) return text;
  return text.slice(0, limit - 1).trimEnd() + "…";
}

/**
 * Converts any value into a string, safely.
 * Strings are returned as-is, numbers and booleans become text, and
 * everything else (objects, arrays, null, undefined) becomes "".
 */
export function toSafeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return "";
}

/**
 * Collapses all kinds of whitespace (tabs, new lines, non-breaking spaces,
 * Unicode line separators…) into single normal spaces and trims the ends.
 * Also removes invisible zero-width characters.
 */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "") // zero-width characters
    .replace(/\s+/g, " ") // \s also matches \u00A0, \u2028, \u3000, etc.
    .trim();
}

/**
 * Keeps only the first item for each URL.
 * URLs are compared without their "#fragment", so ".../post#comments" and
 * ".../post" count as the same article.
 */
export function removeDuplicateUrls<T extends { url: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.url.split("#")[0];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The pieces of information an article ID can be built from. */
export type ArticleIdSource = {
  guid?: string; // RSS <guid> or Atom <id>
  url?: string;
  title?: string;
  publishedAt?: string;
  fallback?: string; // anything else stable, e.g. the summary text
};

/**
 * Creates a deterministic article ID: the same input always gives the same ID.
 * Priority:
 *   1. GUID / Atom ID
 *   2. Article URL
 *   3. Title + publication date
 *   4. Fallback text (for example the summary)
 * The feed URL is always included, so two feeds never share IDs.
 * Format: "<feed hash>-<hash>" for 1 and 2 (unchanged from earlier versions, so
 * articles saved before still match), "<feed hash>-t-<hash>" for 3 and
 * "<feed hash>-f-<hash>" for 4.
 */
export function createArticleId(feedUrl: string, source: ArticleIdSource): string {
  const feedHash = hashString(feedUrl);
  const guid = source.guid?.trim();
  if (guid) return `${feedHash}-${hashString(guid)}`;

  const url = source.url?.trim();
  if (url) return `${feedHash}-${hashString(url)}`;

  const title = source.title?.trim();
  const date = source.publishedAt?.trim();
  if (title && date) return `${feedHash}-t-${hashString(`${title}|${date}`)}`;

  // Last resort: whatever stable text we have (may be empty, still deterministic).
  return `${feedHash}-f-${hashString(`${title ?? ""}|${source.fallback ?? ""}`)}`;
}

/**
 * Converts a date string to an ISO string. Returns undefined if it is not a
 * real date, or if the year is clearly wrong (before 1900 or after 2200).
 */
export function toIsoDate(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const date = new Date(value.trim());
  const time = date.getTime();
  if (Number.isNaN(time)) return undefined;
  const year = date.getUTCFullYear();
  if (year < 1900 || year > 2200) return undefined;
  return date.toISOString();
}

/**
 * Turns a possibly-relative link into an absolute http(s) URL.
 * Returns undefined for unsafe or broken links (for example "javascript:alert(1)").
 */
export function toSafeHttpUrl(value: string | undefined, baseUrl?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = baseUrl ? new URL(value.trim(), baseUrl) : new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/** Formats an ISO date for people, e.g. "29 Oct 2026". Used only in the browser UI. */
export function formatDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
