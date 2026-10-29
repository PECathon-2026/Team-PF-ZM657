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
  const text = html
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
    .replace(/[ \t\f\v ]+/g, " ") // collapse spaces
    .replace(/ *\n */g, "\n") // trim spaces around line breaks
    .replace(/\n{3,}/g, "\n\n") // at most one blank line
    .trim();
}

/** Shortens text to `maxLength` characters and adds "…" if it was cut. */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1).trimEnd() + "…";
}

/** Converts a date string to ISO format. Returns undefined if it is not a real date. */
export function toIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
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
