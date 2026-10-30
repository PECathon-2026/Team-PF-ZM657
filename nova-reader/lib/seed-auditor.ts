// Seed List Trap Detector & Mentor Report Engine (PECathon Bonus Challenge).
//
// Optimised specifically for detecting deliberate seed-list traps in seconds:
//   1. Two URLs for the same blog — detected via:
//      • Raw/canonical input URL duplicates (trailing slashes, www., http/https, tracking params)
//      • HTTP redirect convergence (two seed URLs redirecting to the same final feed URL)
//      • Canonical `siteUrl` match (e.g. /rss.xml and /atom.xml belonging to the same blog)
//      • Cross-domain / mirror article overlap (Jaccard / shared post URLs or titles + dates)
//      • Identical raw XML SHA-256 content hash
//   2. Malformed or broken feeds — detected via:
//      • Exact XML syntax validation (`line`, `col`, error message, and offending XML snippet)
//      • HTML web pages or JSON masquerading as RSS/Atom feeds (`UNSUPPORTED_CONTENT_TYPE` / `UNSUPPORTED_FORMAT`)
//      • Broken/empty item links (XML has <item>/<entry> tags, yet 0 valid http(s) links survive)
//      • Invalid/blocked URLs, redirect loops, timeouts, or HTTP 4xx/5xx upstream failures

import { XMLValidator } from "fast-xml-parser";
import { computeSha256HexSync } from "./blockchain-compliance";
import { FeedParseError, parseFeedXml } from "./feed-parser";
import type { ApiErrorCode, CachedFeed, FeedInfo, FeedItem } from "./feed-types";

export type SeedFeedFormat = "RSS 2.0" | "RSS 1.0 (RDF)" | "Atom" | "Unknown";

export type XmlSyntaxDiagnostic = {
  code: string;
  message: string;
  line: number;
  col: number;
  lineSnippet?: string;
};

export type AuditedSeedEntry = {
  /** 1-based position in the submitted seed list (#1, #2, …). */
  seedIndex: number;
  inputUrl: string;
  finalUrl?: string;
  ok: boolean;
  format?: SeedFeedFormat;
  feed?: FeedInfo;
  items?: FeedItem[];
  rawEntryCount?: number;
  xmlSha256?: string;
  errorCode?: ApiErrorCode | string;
  errorMessage?: string;
  xmlDiagnostic?: XmlSyntaxDiagnostic;
  durationMs?: number;
};

export type TrapCategory = "DUPLICATE_BLOG" | "MALFORMED_FEED";

export type TrapSubkind =
  | "EXACT_OR_CANONICAL_INPUT_URL"
  | "REDIRECT_SAME_FEED_URL"
  | "SAME_BLOG_SITE_URL"
  | "SHARED_ARTICLES_MIRROR"
  | "IDENTICAL_XML_HASH"
  | "INVALID_XML_SYNTAX"
  | "NOT_A_FEED_FORMAT"
  | "BROKEN_EMPTY_ITEMS"
  | "FETCH_OR_URL_ERROR";

export type DetectedSeedTrap = {
  id: string;
  category: TrapCategory;
  subkind: TrapSubkind;
  confidence: "CONFIRMED" | "HIGH";
  headline: string;
  seedIndices: number[];
  urls: string[];
  evidence: string[];
  recommendation: string;
};

export type SeedAuditSummary = {
  auditedAt: string;
  totalSubmitted: number;
  healthyCount: number;
  trapCount: number;
  auditSha256: string;
  entries: AuditedSeedEntry[];
  traps: DetectedSeedTrap[];
};

/**
 * Extracts all candidate feed URLs from pasted text:
 * supports OPML (`xmlUrl="..."`), JSON string arrays, Markdown `[label](url)`, CSV, or plain lines.
 */
export function extractSeedUrls(rawText: string): string[] {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  // 1. OPML XML (<outline xmlUrl="https://..." />)
  if (/<opml[\s>]/i.test(trimmed) || /xmlUrl\s*=\s*["']/i.test(trimmed)) {
    const opmlUrls: string[] = [];
    const regex = /xmlUrl\s*=\s*["']([^"']+)["']/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(trimmed)) !== null) {
      const candidate = decodeXmlAttrEntities(match[1].trim());
      if (candidate) opmlUrls.push(candidate);
    }
    if (opmlUrls.length > 0) return opmlUrls;
  }

  // 2. JSON array of strings or objects ({ url / feedUrl / xmlUrl })
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        const jsonUrls: string[] = [];
        for (const entry of parsed) {
          if (typeof entry === "string" && entry.trim()) {
            jsonUrls.push(entry.trim());
          } else if (entry && typeof entry === "object") {
            const rec = entry as Record<string, unknown>;
            const u = rec.url ?? rec.feedUrl ?? rec.xmlUrl ?? rec.href;
            if (typeof u === "string" && u.trim()) jsonUrls.push(u.trim());
          }
        }
        if (jsonUrls.length > 0) return jsonUrls;
      }
    } catch {
      // fall through to line/token extraction
    }
  }

  // 3. Line-by-line / Markdown / CSV extraction (keeps deliberately malformed URLs too so we catch URL traps!)
  const results: string[] = [];
  const lines = trimmed.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;

    // Markdown links: [Blog Name](https://example.com/feed.xml)
    const mdMatches = [...line.matchAll(/\[[^\]]*]\(([^)\s]+)\)/g)];
    if (mdMatches.length > 0) {
      for (const m of mdMatches) {
        if (m[1]) results.push(m[1].trim());
      }
      continue;
    }

    // Multiple http(s) URLs on one line or comma-separated tokens
    const httpMatches = [...line.matchAll(/https?:\/\/[^\s,;"'<>)\]]+/gi)];
    if (httpMatches.length > 0) {
      for (const m of httpMatches) {
        results.push(m[0].replace(/[.,;]+$/, ""));
      }
      continue;
    }

    // Strip leading list bullets/numbers like "1. " or "- " to catch non-http malformed URL traps (e.g. "ftp://..." or "example.com/rss")
    const cleanedToken = line.replace(/^(?:[-*•]|\d+[.)])\s+/, "").trim();
    if (cleanedToken && /[./:]/.test(cleanedToken) && !/\s/.test(cleanedToken)) {
      results.push(cleanedToken);
    }
  }

  return results;
}

function decodeXmlAttrEntities(val: string): string {
  return val
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Normalizes a URL for blog-identity comparison (protocol-agnostic, strips www., trailing slash, utm_*). */
export function canonicalizeComparableUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const defaultPort = (parsed.protocol === "http:" && parsed.port === "80") || (parsed.protocol === "https:" && parsed.port === "443");
    const portPart = parsed.port && !defaultPort ? `:${parsed.port}` : "";
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";

    const keptParams: [string, string][] = [];
    parsed.searchParams.forEach((v, k) => {
      if (!/^utm_|^ref$|^source$/i.test(k)) {
        keptParams.push([k.toLowerCase(), v]);
      }
    });
    keptParams.sort((a, b) => a[0].localeCompare(b[0]));
    const query = keptParams.length > 0 ? `?${keptParams.map(([k, v]) => `${k}=${v}`).join("&")}` : "";

    return `${host}${portPart}${pathname}${query}`;
  } catch {
    return null;
  }
}

function detectRootFormat(xml: string): SeedFeedFormat {
  const cleaned = xml.replace(/^\uFEFF/, "").slice(0, 4000);
  if (/<\s*rss\b/i.test(cleaned)) return "RSS 2.0";
  if (/<\s*rdf:RDF\b/i.test(cleaned)) return "RSS 1.0 (RDF)";
  if (/<\s*(?:[a-z0-9_-]+:)?feed\b/i.test(cleaned)) return "Atom";
  return "Unknown";
}

function countRawEntries(xml: string): number {
  const itemMatches = xml.match(/<\s*item[\s>]/gi)?.length ?? 0;
  const entryMatches = xml.match(/<\s*(?:[a-z0-9_-]+:)?entry[\s>]/gi)?.length ?? 0;
  return itemMatches + entryMatches;
}

/**
 * Deeply inspects raw XML from a fetched seed URL and returns either parsed feed metadata
 * or pinpoint malformed-XML diagnostics (exact line, column, error code, and snippet).
 */
export function inspectRawFeedXml(
  seedIndex: number,
  inputUrl: string,
  xml: string,
  finalUrl: string,
  durationMs?: number,
): AuditedSeedEntry {
  const trimmed = xml.replace(/^\uFEFF/, "").trim();
  const xmlSha256 = computeSha256HexSync(trimmed);

  if (!trimmed) {
    return {
      seedIndex,
      inputUrl,
      finalUrl,
      ok: false,
      xmlSha256,
      errorCode: "INVALID_XML",
      errorMessage: "Feed body is completely empty (0 bytes of XML).",
      durationMs,
    };
  }

  // Catch HTML pages served with lenient text/plain or misconfigured XML headers
  if (/^<!doctype\s+html\b|^<html[\s>]/i.test(trimmed)) {
    return {
      seedIndex,
      inputUrl,
      finalUrl,
      ok: false,
      xmlSha256,
      errorCode: "UNSUPPORTED_FORMAT",
      errorMessage: "URL returned an HTML webpage instead of an RSS or Atom XML feed.",
      durationMs,
    };
  }

  // Pinpoint XML syntax validation with exact line & column
  const validation = XMLValidator.validate(trimmed);
  if (validation !== true) {
    const err = validation.err;
    const lines = trimmed.split(/\r?\n/);
    const rawLine = err.line >= 1 && err.line <= lines.length ? lines[err.line - 1] : undefined;
    const lineSnippet = rawLine ? rawLine.trim().slice(0, 160) : undefined;
    return {
      seedIndex,
      inputUrl,
      finalUrl,
      ok: false,
      xmlSha256,
      errorCode: "INVALID_XML",
      errorMessage: `Malformed XML at line ${err.line}, column ${err.col}: ${err.msg}`,
      xmlDiagnostic: {
        code: err.code,
        message: err.msg,
        line: err.line,
        col: err.col,
        lineSnippet,
      },
      durationMs,
    };
  }

  const format = detectRootFormat(trimmed);
  const rawEntryCount = countRawEntries(trimmed);

  try {
    const parsed = parseFeedXml(trimmed, finalUrl);
    const { items, ...feed } = parsed;
    return {
      seedIndex,
      inputUrl,
      finalUrl,
      ok: true,
      format,
      feed,
      items,
      rawEntryCount,
      xmlSha256,
      durationMs,
    };
  } catch (error) {
    if (error instanceof FeedParseError) {
      return {
        seedIndex,
        inputUrl,
        finalUrl,
        ok: false,
        format,
        rawEntryCount,
        xmlSha256,
        errorCode: error.code,
        errorMessage: error.message,
        durationMs,
      };
    }
    return {
      seedIndex,
      inputUrl,
      finalUrl,
      ok: false,
      format,
      rawEntryCount,
      xmlSha256,
      errorCode: "INVALID_XML",
      errorMessage: "The XML document could not be parsed as RSS or Atom.",
      durationMs,
    };
  }
}

/**
 * Analyses all audited seed entries and identifies deliberate traps:
 *   1. Malformed / non-feed / broken-item endpoints
 *   2. Duplicate URLs pointing to the same blog (via canonical URL, redirect target,
 *      shared `siteUrl`, article overlap, or identical XML hash)
 */
export function detectSeedListTraps(entries: AuditedSeedEntry[]): DetectedSeedTrap[] {
  const traps: DetectedSeedTrap[] = [];

  // --- A. Malformed / Broken / Non-Feed Traps ---
  for (const entry of entries) {
    if (!entry.ok) {
      const isXmlSyntax = Boolean(entry.xmlDiagnostic) || entry.errorCode === "INVALID_XML";
      const isNotFeed = entry.errorCode === "UNSUPPORTED_FORMAT" || entry.errorCode === "UNSUPPORTED_CONTENT_TYPE";

      const evidence: string[] = [];
      if (entry.xmlDiagnostic) {
        evidence.push(
          `XML parser error [${entry.xmlDiagnostic.code}] at Line ${entry.xmlDiagnostic.line}, Column ${entry.xmlDiagnostic.col}: ${entry.xmlDiagnostic.message}`,
        );
        if (entry.xmlDiagnostic.lineSnippet) {
          evidence.push(`Offending XML snippet: \`${entry.xmlDiagnostic.lineSnippet}\``);
        }
      } else if (entry.errorMessage) {
        evidence.push(`${entry.errorCode ?? "ERROR"}: ${entry.errorMessage}`);
      }
      if (entry.finalUrl && entry.finalUrl !== entry.inputUrl) {
        evidence.push(`Redirected from ${entry.inputUrl} → ${entry.finalUrl}`);
      }

      traps.push({
        id: `trap-malformed-${entry.seedIndex}`,
        category: "MALFORMED_FEED",
        subkind: isXmlSyntax ? "INVALID_XML_SYNTAX" : isNotFeed ? "NOT_A_FEED_FORMAT" : "FETCH_OR_URL_ERROR",
        confidence: "CONFIRMED",
        headline: isXmlSyntax
          ? `Malformed XML feed at Seed #${entry.seedIndex}`
          : isNotFeed
            ? `Non-feed URL (HTML / unsupported format) at Seed #${entry.seedIndex}`
            : `Unreachable or invalid feed URL at Seed #${entry.seedIndex}`,
        seedIndices: [entry.seedIndex],
        urls: [entry.inputUrl],
        evidence,
        recommendation: isXmlSyntax
          ? "Quarantine or exclude this malformed feed URL and report the XML syntax error line/column to the mentors."
          : isNotFeed
            ? "Replace the webpage URL with the blog's actual RSS/Atom XML endpoint, or exclude it as the deliberate trap."
            : "Exclude this broken endpoint from active subscriptions and report the failure code to the mentors.",
      });
      continue;
    }

    // Structurally broken feed: XML had <item>/<entry> tags, yet 0 items had valid http(s) links!
    if ((entry.rawEntryCount ?? 0) > 0 && (entry.items?.length ?? 0) === 0) {
      traps.push({
        id: `trap-broken-items-${entry.seedIndex}`,
        category: "MALFORMED_FEED",
        subkind: "BROKEN_EMPTY_ITEMS",
        confidence: "CONFIRMED",
        headline: `Malformed feed items (0 valid links out of ${entry.rawEntryCount} entries) at Seed #${entry.seedIndex}`,
        seedIndices: [entry.seedIndex],
        urls: [entry.inputUrl],
        evidence: [
          `Raw XML contains ${entry.rawEntryCount} <item>/<entry> elements, but none contain a valid http(s) permalink.`,
        ],
        recommendation: "Report as a structurally malformed feed whose entries lack valid article links.",
      });
    }
  }

  // --- B. Pairwise Duplicate Blog Traps ---
  // Compare every pair (i, j) so we catch exact input duplicates even if offline/failed,
  // plus redirect collisions, shared siteUrl (RSS + Atom of same blog), and article overlap.
  const pairedKeys = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      const pairKey = `${a.seedIndex}-${b.seedIndex}`;

      // 1. Canonical input URL match (e.g. http vs https, www., trailing slash)
      const canonInputA = canonicalizeComparableUrl(a.inputUrl);
      const canonInputB = canonicalizeComparableUrl(b.inputUrl);
      if (canonInputA && canonInputB && canonInputA === canonInputB) {
        pairedKeys.add(pairKey);
        traps.push({
          id: `trap-dup-input-${pairKey}`,
          category: "DUPLICATE_BLOG",
          subkind: "EXACT_OR_CANONICAL_INPUT_URL",
          confidence: "CONFIRMED",
          headline: `Duplicate feed URLs in seed list (Seed #${a.seedIndex} & Seed #${b.seedIndex})`,
          seedIndices: [a.seedIndex, b.seedIndex],
          urls: [a.inputUrl, b.inputUrl],
          evidence: [
            `Both URLs normalize to the same canonical endpoint: ${canonInputA}`,
          ],
          recommendation: `Keep Seed #${a.seedIndex} (${a.inputUrl}) and deduplicate Seed #${b.seedIndex}.`,
        });
        continue;
      }

      if (!a.ok || !b.ok || !a.feed || !b.feed) continue;

      // 2. HTTP Redirect convergence to the exact same final feed URL
      const canonFinalA = canonicalizeComparableUrl(a.finalUrl ?? a.feed.feedUrl);
      const canonFinalB = canonicalizeComparableUrl(b.finalUrl ?? b.feed.feedUrl);
      if (canonFinalA && canonFinalB && canonFinalA === canonFinalB) {
        pairedKeys.add(pairKey);
        traps.push({
          id: `trap-dup-redirect-${pairKey}`,
          category: "DUPLICATE_BLOG",
          subkind: "REDIRECT_SAME_FEED_URL",
          confidence: "CONFIRMED",
          headline: `Two seed URLs resolve to the same feed (Seed #${a.seedIndex} & Seed #${b.seedIndex})`,
          seedIndices: [a.seedIndex, b.seedIndex],
          urls: [a.inputUrl, b.inputUrl],
          evidence: [
            `Seed #${a.seedIndex} resolved to ${a.finalUrl ?? a.feed.feedUrl}`,
            `Seed #${b.seedIndex} resolved to ${b.finalUrl ?? b.feed.feedUrl}`,
            `Blog title: "${a.feed.title}"`,
          ],
          recommendation: `Deduplicate to a single canonical URL (${a.finalUrl ?? a.inputUrl}).`,
        });
        continue;
      }

      // 3. Identical Raw XML SHA-256 Hash across two distinct URLs
      if (a.xmlSha256 && b.xmlSha256 && a.xmlSha256 === b.xmlSha256) {
        pairedKeys.add(pairKey);
        traps.push({
          id: `trap-dup-hash-${pairKey}`,
          category: "DUPLICATE_BLOG",
          subkind: "IDENTICAL_XML_HASH",
          confidence: "CONFIRMED",
          headline: `Byte-identical feed XML served at two URLs (Seed #${a.seedIndex} & Seed #${b.seedIndex})`,
          seedIndices: [a.seedIndex, b.seedIndex],
          urls: [a.inputUrl, b.inputUrl],
          evidence: [
            `Both endpoints returned identical XML (SHA-256: ${a.xmlSha256.slice(0, 24)}…).`,
            `Blog title: "${a.feed.title}"`,
          ],
          recommendation: `Keep one canonical feed URL (${a.inputUrl}) and drop the alias (${b.inputUrl}).`,
        });
        continue;
      }

      // 4. Same canonical `siteUrl` (classic trap: /rss.xml + /atom.xml or /feed/ + /index.xml for the same blog!)
      const siteA = canonicalizeComparableUrl(a.feed.siteUrl);
      const siteB = canonicalizeComparableUrl(b.feed.siteUrl);
      const overlap = computeArticleOverlap(a.items ?? [], b.items ?? []);

      if (siteA && siteB && siteA === siteB && !pairedKeys.has(pairKey)) {
        pairedKeys.add(pairKey);
        const formatNote =
          a.format && b.format && a.format !== b.format
            ? `Formats: ${a.format} vs ${b.format} for the same publication.`
            : `Both feeds declare canonical blog site: ${siteA}.`;
        const evidence = [
          `Both feeds point to the same canonical blog website (${siteA}).`,
          `Titles: "${a.feed.title}" (#${a.seedIndex}) and "${b.feed.title}" (#${b.seedIndex}).`,
          formatNote,
        ];
        if (overlap.sharedCount > 0) {
          evidence.push(
            `${overlap.sharedCount} overlapping articles verified (e.g. "${overlap.sampleTitles[0]}").`,
          );
        }
        traps.push({
          id: `trap-dup-site-${pairKey}`,
          category: "DUPLICATE_BLOG",
          subkind: "SAME_BLOG_SITE_URL",
          confidence: "CONFIRMED",
          headline: `Two feed URLs for the same blog "${a.feed.title}" (Seed #${a.seedIndex} & Seed #${b.seedIndex})`,
          seedIndices: [a.seedIndex, b.seedIndex],
          urls: [a.inputUrl, b.inputUrl],
          evidence,
          recommendation: `Keep one preferred feed (${a.inputUrl}) and skip duplicate endpoint (${b.inputUrl}).`,
        });
        continue;
      }

      // 5. Article overlap / mirrored domain trap (even if `siteUrl` differs or is missing!)
      if (overlap.sharedCount >= 2 || (overlap.sharedCount >= 1 && overlap.jaccard >= 0.4)) {
        pairedKeys.add(pairKey);
        traps.push({
          id: `trap-dup-articles-${pairKey}`,
          category: "DUPLICATE_BLOG",
          subkind: "SHARED_ARTICLES_MIRROR",
          confidence: overlap.sharedCount >= 2 ? "CONFIRMED" : "HIGH",
          headline: `Mirrored / duplicate blog detected via shared posts (Seed #${a.seedIndex} & Seed #${b.seedIndex})`,
          seedIndices: [a.seedIndex, b.seedIndex],
          urls: [a.inputUrl, b.inputUrl],
          evidence: [
            `${overlap.sharedCount} matching articles (${Math.round(overlap.jaccard * 100)}% overlap) between "${a.feed.title}" and "${b.feed.title}".`,
            `Matching post example: "${overlap.sampleTitles.join('", "')}"`,
          ],
          recommendation: `Treat Seed #${a.seedIndex} and Seed #${b.seedIndex} as the same blog and deduplicate.`,
        });
      }
    }
  }

  return traps;
}

function computeArticleOverlap(
  itemsA: FeedItem[],
  itemsB: FeedItem[],
): { sharedCount: number; jaccard: number; sampleTitles: string[] } {
  if (itemsA.length === 0 || itemsB.length === 0) {
    return { sharedCount: 0, jaccard: 0, sampleTitles: [] };
  }

  const keysA = new Map<string, string>();
  for (const item of itemsA) {
    const urlKey = canonicalizeComparableUrl(item.url);
    if (urlKey) keysA.set(`url:${urlKey}`, item.title);
    const normTitle = item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (normTitle.length >= 12) keysA.set(`title:${normTitle}`, item.title);
  }

  const matchedTitles = new Set<string>();
  const unionKeys = new Set<string>(keysA.keys());

  for (const item of itemsB) {
    const urlKey = canonicalizeComparableUrl(item.url);
    const normTitle = item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const uToken = urlKey ? `url:${urlKey}` : null;
    const tToken = normTitle.length >= 12 ? `title:${normTitle}` : null;

    if (uToken) {
      unionKeys.add(uToken);
      if (keysA.has(uToken)) matchedTitles.add(keysA.get(uToken) ?? item.title);
    }
    if (tToken) {
      unionKeys.add(tToken);
      if (keysA.has(tToken)) matchedTitles.add(keysA.get(tToken) ?? item.title);
    }
  }

  const sharedCount = matchedTitles.size;
  const minFeedLen = Math.min(itemsA.length, itemsB.length);
  const jaccard = minFeedLen > 0 ? sharedCount / minFeedLen : 0;
  return {
    sharedCount,
    jaccard: Math.min(1, jaccard),
    sampleTitles: Array.from(matchedTitles).slice(0, 2),
  };
}

/**
 * Passive single-feed check: when a user loads one feed via the main search bar,
 * checks if it duplicates any previously loaded feed in IndexedDB (`cachedFeeds`).
 */
export function checkSingleFeedDuplicateTrap(
  requestedUrl: string,
  newFeed: FeedInfo,
  newItems: FeedItem[],
  cachedFeeds: CachedFeed[],
): DetectedSeedTrap | null {
  const newReqCanon = canonicalizeComparableUrl(requestedUrl);
  const newFinalCanon = canonicalizeComparableUrl(newFeed.feedUrl);

  const syntheticNew: AuditedSeedEntry = {
    seedIndex: 2,
    inputUrl: requestedUrl,
    finalUrl: newFeed.feedUrl,
    ok: true,
    feed: newFeed,
    items: newItems,
  };

  for (const cached of cachedFeeds) {
    const cachedReqCanon = canonicalizeComparableUrl(cached.requestedUrl);
    const cachedFinalCanon = canonicalizeComparableUrl(cached.feed.feedUrl);

    // Refreshing the exact same URL is normal usage, NOT a two-URL trap!
    if (newReqCanon && cachedReqCanon && newReqCanon === cachedReqCanon) continue;

    // However, if the user typed a DIFFERENT URL that redirected to or matches an already-loaded blog, flag it!
    const syntheticCached: AuditedSeedEntry = {
      seedIndex: 1,
      inputUrl: cached.requestedUrl,
      finalUrl: cached.feed.feedUrl,
      ok: true,
      feed: cached.feed,
      items: cached.items,
    };

    if (newFinalCanon && cachedFinalCanon && newFinalCanon === cachedFinalCanon) {
      return {
        id: `live-dup-redirect-${cached.requestedUrl}`,
        category: "DUPLICATE_BLOG",
        subkind: "REDIRECT_SAME_FEED_URL",
        confidence: "CONFIRMED",
        headline: `Duplicate blog trap detected: two different URLs resolve to "${newFeed.title}"`,
        seedIndices: [1, 2],
        urls: [cached.requestedUrl, requestedUrl],
        evidence: [
          `Previously loaded URL: ${cached.requestedUrl}`,
          `Newly submitted URL: ${requestedUrl}`,
          `Both resolve to canonical feed: ${newFeed.feedUrl}`,
        ],
        recommendation: `Report ${cached.requestedUrl} and ${requestedUrl} as duplicate URLs for "${newFeed.title}".`,
      };
    }

    const detected = detectSeedListTraps([syntheticCached, syntheticNew]).find((t) => t.category === "DUPLICATE_BLOG");
    if (detected) {
      return detected;
    }
  }

  return null;
}

/** Builds a complete `SeedAuditSummary` with deterministic SHA-256 evidence digest. */
export function finalizeSeedAudit(entries: AuditedSeedEntry[], auditedAt = new Date().toISOString()): SeedAuditSummary {
  const traps = detectSeedListTraps(entries);
  const trapIndices = new Set<number>();
  for (const trap of traps) {
    for (const idx of trap.seedIndices) trapIndices.add(idx);
  }
  const healthyCount = entries.filter((e) => e.ok && !trapIndices.has(e.seedIndex)).length;
  const auditSha256 = computeSha256HexSync(
    JSON.stringify({
      auditedAt,
      entries: entries.map((e) => ({
        i: e.seedIndex,
        u: e.inputUrl,
        ok: e.ok,
        h: e.xmlSha256 ?? null,
        err: e.errorCode ?? null,
      })),
      traps: traps.map((t) => ({ c: t.category, s: t.subkind, u: t.urls })),
    }),
  );

  return {
    auditedAt,
    totalSubmitted: entries.length,
    healthyCount,
    trapCount: traps.length,
    auditSha256,
    entries,
    traps,
  };
}

/** Generates a concise, mentor-ready report formatted for instant Slack/Discord/form submission. */
export function buildMentorTrapReport(summary: SeedAuditSummary, complianceBlockHash?: string): string {
  const lines: string[] = [
    "=== NOVA READER — SEED LIST TRAP REPORT ===",
    `Timestamp (UTC): ${summary.auditedAt}`,
    `Seeds Audited:   ${summary.totalSubmitted} (${summary.healthyCount} clean, ${summary.traps.length} trap${summary.traps.length === 1 ? "" : "s"} flagged)`,
    `Audit SHA-256:   ${summary.auditSha256}`,
  ];

  if (complianceBlockHash) {
    lines.push(`Ledger Block:    ${complianceBlockHash}`);
  }
  lines.push("");

  if (summary.traps.length === 0) {
    lines.push("Result: No duplicate blogs or malformed feeds were detected in this batch.");
    return lines.join("\n");
  }

  summary.traps.forEach((trap, index) => {
    lines.push(`[TRAP ${index + 1}] ${trap.category} (${trap.subkind}) — Confidence: ${trap.confidence}`);
    lines.push(`Summary: ${trap.headline}`);
    trap.urls.forEach((url, i) => {
      const seedNum = trap.seedIndices[i];
      lines.push(`  • Seed #${seedNum ?? i + 1}: ${url}`);
    });
    lines.push("Technical Evidence:");
    for (const ev of trap.evidence) {
      lines.push(`  - ${ev}`);
    }
    lines.push(`Action: ${trap.recommendation}`);
    lines.push("");
  });

  return lines.join("\n").trim();
}
