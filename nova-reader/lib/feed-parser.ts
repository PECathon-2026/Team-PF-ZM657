// RSS + Atom parser.
// Turns raw feed XML text into our simple `Feed` type.
//
// Where it runs: BOTH. It is a pure function (no network, no storage, no
// Node-only or browser-only code). Today the API route calls it on the server;
// later it can run in the browser unchanged (PECathon PS-003 asks for that).
//
// Safety: feed content is UNTRUSTED. Titles, summaries, authors and categories
// become plain text. Every URL is resolved and must be http(s), so values like
// "javascript:..." never come out. `contentHtml` is kept as raw, untrusted HTML
// and is only ever displayed after DOMPurify sanitizes it in the browser.
// Nothing in this file executes or renders feed content.

import { XMLParser, XMLValidator } from "fast-xml-parser";
import { FEED_LIMITS, type Feed, type FeedItem, type ParserOptions } from "./feed-types";
import {
  createArticleId,
  htmlToText,
  normalizeWhitespace,
  removeDuplicateUrls,
  toIsoDate,
  toSafeHttpUrl,
  toSafeString,
  truncate,
} from "./utils";

export type FeedParseErrorCode = "INVALID_XML" | "UNSUPPORTED_FORMAT" | "RESPONSE_TOO_LARGE";

/** Error thrown when the XML is empty, too big, broken, or not RSS/Atom. */
export class FeedParseError extends Error {
  constructor(
    public readonly code: FeedParseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FeedParseError";
  }
}

/** Result type for callers who prefer no exceptions. */
export type ParseFeedResult =
  | { ok: true; feed: Feed }
  | { ok: false; code: FeedParseErrorCode; message: string };

// Parsed XML is a tree of unknown shape, so we treat every node as `unknown`
// and check it before use. (This is why we never need `any`.)
type XmlNode = Record<string, unknown>;

// Tags that can repeat. Forcing them to be arrays means "one" and "many" look
// the same. (Our helpers also accept single objects, for prefixed tags.)
const ARRAY_TAGS = new Set([
  "item",
  "entry",
  "link",
  "author",
  "category",
  "dc:subject",
  "media:content",
  "media:thumbnail",
  "media:group",
]);

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false, // keep every value as a string
  parseAttributeValue: false,
  trimValues: true,
  // Namespace prefixes are KEPT (e.g. "content:encoded", "dc:creator"), because
  // removing them would mix up Atom <content> and <media:content>.
  removeNSPrefix: false,
  // Entity expansion uses fast-xml-parser's built-in limits, which protect
  // against "billion laughs" style XML bombs.
  processEntities: true,
  isArray: (tagName) => ARRAY_TAGS.has(tagName),
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses RSS 2.0, RSS 1.0 (RDF) or Atom XML into a normalized `Feed`.
 *
 * @param xml     Raw feed text from the internet (untrusted, max 2 MB).
 * @param feedUrl The URL the feed came from. Used for relative links and IDs.
 * @param options Optional settings, e.g. { maxItems: 20 }.
 * @throws FeedParseError for empty, oversized, malformed or unsupported XML.
 */
export function parseFeedXml(xml: string, feedUrl: string, options: ParserOptions = {}): Feed {
  const maxItems = clampMaxItems(options.maxItems);
  const tree = parseXml(xml);
  const rootName = Object.keys(tree).find((key) => !key.startsWith("?") && !key.startsWith("#"));
  const root = rootName ? asNode(tree[rootName]) : undefined;

  if (rootName === "rss" && root) {
    return parseRss(asNode(root["channel"]) ?? {}, feedUrl, maxItems);
  }
  if (rootName === "rdf:RDF" && root) {
    // RSS 1.0: <item> elements are siblings of <channel>, not children.
    return parseRss({ ...(asNode(root["channel"]) ?? {}), item: root["item"] }, feedUrl, maxItems);
  }
  if (rootName && root && (rootName === "feed" || rootName.endsWith(":feed"))) {
    // Atom. If the document uses a prefix (<atom:feed>), remove it so the rest
    // of the code can look for plain names like "entry" and "title".
    const prefix = rootName === "feed" ? undefined : rootName.slice(0, -":feed".length);
    const atom = prefix ? asNode(stripPrefix(root, prefix)) ?? {} : root;
    return parseAtom(atom, feedUrl, maxItems);
  }

  throw new FeedParseError("UNSUPPORTED_FORMAT", "This URL did not return an RSS or Atom feed.");
}

/** Same as parseFeedXml, but returns { ok, ... } instead of throwing. */
export function safeParseFeedXml(xml: string, feedUrl: string, options?: ParserOptions): ParseFeedResult {
  try {
    return { ok: true, feed: parseFeedXml(xml, feedUrl, options) };
  } catch (error) {
    if (error instanceof FeedParseError) return { ok: false, code: error.code, message: error.message };
    return { ok: false, code: "INVALID_XML", message: "The feed could not be read." };
  }
}

/** Older name, kept so existing code (app/api/feed/route.ts) keeps working. */
export const parseFeed = parseFeedXml;

// ---------------------------------------------------------------------------
// XML reading
// ---------------------------------------------------------------------------

function parseXml(xml: string): XmlNode {
  if (typeof xml !== "string") throw new FeedParseError("INVALID_XML", "The feed is empty.");

  // Check size BEFORE parsing. Characters ≤ bytes, so the cheap length check
  // catches most oversized input without encoding it.
  if (xml.length > FEED_LIMITS.maxXmlBytes || new TextEncoder().encode(xml).byteLength > FEED_LIMITS.maxXmlBytes) {
    throw new FeedParseError("RESPONSE_TOO_LARGE", "The feed is too large (limit is 2 MB).");
  }

  const trimmed = xml.replace(/^\uFEFF/, "").trim(); // remove byte-order mark
  if (!trimmed) throw new FeedParseError("INVALID_XML", "The feed is empty.");

  if (XMLValidator.validate(trimmed) !== true) {
    throw new FeedParseError("INVALID_XML", "The feed is not valid XML.");
  }
  try {
    const tree = xmlParser.parse(trimmed);
    const node = asNode(tree);
    if (!node) throw new Error("not an object");
    return node;
  } catch {
    throw new FeedParseError("INVALID_XML", "The feed could not be read.");
  }
}

// ---------------------------------------------------------------------------
// RSS 2.0 (and RSS 1.0)
// ---------------------------------------------------------------------------

function parseRss(channel: XmlNode, feedUrl: string, maxItems: number): Feed {
  const siteUrl =
    toSafeHttpUrl(firstText(channel["link"]), feedUrl) ??
    toSafeHttpUrl(findAtomLink(channel["atom:link"], "alternate"), feedUrl);
  const baseUrl = siteUrl ?? feedUrl;

  const items = nodes(channel["item"])
    .map((item) => parseRssItem(item, baseUrl, feedUrl))
    .filter((item): item is FeedItem => item !== undefined);

  return {
    title: cleanText(channel["title"], FEED_LIMITS.maxTitleLength) || "Untitled feed",
    description: cleanText(channel["description"], FEED_LIMITS.maxDescriptionLength) || undefined,
    siteUrl,
    feedUrl,
    items: finalizeItems(items, maxItems),
  };
}

function parseRssItem(item: XmlNode, baseUrl: string, feedUrl: string): FeedItem | undefined {
  const guidNode = item["guid"];
  const guid = text(guidNode);
  const url = toSafeHttpUrl(firstText(item["link"]), baseUrl) ?? guidAsUrl(guidNode);
  if (!url) return undefined; // no safe link → nothing to open, so the item is skipped

  const title = cleanText(item["title"], FEED_LIMITS.maxTitleLength) || "Untitled article";
  const content = text(item["content:encoded"]) || text(item["description"]);
  const summary = truncate(htmlToText(content), FEED_LIMITS.maxSummaryLength);
  const publishedAt = toIsoDate(text(item["pubDate"]) || text(item["dc:date"]));

  return {
    id: createArticleId(feedUrl, { guid, url, title, publishedAt, fallback: summary }),
    title,
    url,
    summary,
    contentHtml: keepHtml(content),
    author: cleanText(text(item["dc:creator"]) || firstText(item["author"]), FEED_LIMITS.maxAuthorLength) || undefined,
    publishedAt,
    updatedAt: toIsoDate(text(item["atom:updated"]) || text(item["dc:modified"])),
    imageUrl: findImage(item, baseUrl),
    categories: cleanCategories([...nodesOrText(item["category"]), ...nodesOrText(item["dc:subject"])].map(text)),
  };
}

/** RSS <guid> is a permalink unless isPermaLink="false". Only absolute http(s) URLs count. */
function guidAsUrl(guidNode: unknown): string | undefined {
  const node = asNode(guidNode);
  if (node && attr(node, "isPermaLink") === "false") return undefined;
  return toSafeHttpUrl(text(guidNode)); // no base URL: "abc-123" is NOT a link
}

// ---------------------------------------------------------------------------
// Atom
// ---------------------------------------------------------------------------

function parseAtom(feed: XmlNode, feedUrl: string, maxItems: number): Feed {
  const siteUrl = toSafeHttpUrl(findAtomLink(feed["link"], "alternate"), feedUrl);
  const baseUrl = siteUrl ?? feedUrl;
  const feedAuthor = atomAuthorName(feed["author"]);

  const items = nodes(feed["entry"])
    .map((entry) => parseAtomEntry(entry, baseUrl, feedUrl, feedAuthor))
    .filter((item): item is FeedItem => item !== undefined);

  return {
    title: cleanText(feed["title"], FEED_LIMITS.maxTitleLength) || "Untitled feed",
    description: cleanText(feed["subtitle"], FEED_LIMITS.maxDescriptionLength) || undefined,
    siteUrl,
    feedUrl,
    items: finalizeItems(items, maxItems),
  };
}

function parseAtomEntry(
  entry: XmlNode,
  baseUrl: string,
  feedUrl: string,
  feedAuthor: string | undefined,
): FeedItem | undefined {
  const url = toSafeHttpUrl(findAtomLink(entry["link"], "alternate"), baseUrl);
  if (!url) return undefined;

  const title = cleanText(entry["title"], FEED_LIMITS.maxTitleLength) || "Untitled article";
  const content = text(entry["content"]) || text(entry["summary"]);
  const summary = truncate(htmlToText(content), FEED_LIMITS.maxSummaryLength);
  const updatedAt = toIsoDate(text(entry["updated"]));
  const publishedAt = toIsoDate(text(entry["published"])) ?? updatedAt;

  return {
    id: createArticleId(feedUrl, { guid: text(entry["id"]), url, title, publishedAt, fallback: summary }),
    title,
    url,
    summary,
    contentHtml: keepHtml(content),
    author: atomAuthorName(entry["author"]) ?? feedAuthor,
    publishedAt,
    updatedAt,
    imageUrl: findImage(entry, baseUrl),
    // Atom: <category term="web" label="The Web"/> — the label is nicer to show.
    categories: cleanCategories(nodes(entry["category"]).map((c) => attr(c, "label") ?? attr(c, "term") ?? "")),
  };
}

/**
 * Picks an Atom link: rel="alternate" (a missing rel means alternate),
 * preferring an HTML type when there are several alternates.
 */
function findAtomLink(links: unknown, rel: string): string | undefined {
  const matching = nodes(links).filter((n) => (attr(n, "rel") ?? "alternate") === rel);
  const html = matching.find((n) => {
    const type = attr(n, "type");
    return !type || type === "text/html" || type === "application/xhtml+xml";
  });
  const chosen = html ?? matching[0];
  return chosen ? attr(chosen, "href") : undefined;
}

function atomAuthorName(authors: unknown): string | undefined {
  const first = asArray(authors)[0];
  const node = asNode(first);
  const name = node ? text(node["name"]) : text(first);
  return cleanText(name, FEED_LIMITS.maxAuthorLength) || undefined;
}

// ---------------------------------------------------------------------------
// Images (RSS and Atom share these)
// ---------------------------------------------------------------------------

/**
 * Finds an image URL, checking in order: enclosures, media:thumbnail,
 * media:content (images only), the same inside media:group, then itunes:image.
 * Unsafe or broken URLs are skipped and the search continues.
 */
function findImage(item: XmlNode, baseUrl: string): string | undefined {
  const candidates: (string | undefined)[] = [];

  // RSS <enclosure url type="image/..."> and Atom <link rel="enclosure" href type>
  for (const enclosure of nodes(item["enclosure"])) {
    if ((attr(enclosure, "type") ?? "").startsWith("image/")) candidates.push(attr(enclosure, "url"));
  }
  for (const link of nodes(item["link"])) {
    if (attr(link, "rel") === "enclosure" && (attr(link, "type") ?? "").startsWith("image/")) {
      candidates.push(attr(link, "href"));
    }
  }

  for (const container of [item, ...nodes(item["media:group"])]) {
    for (const thumb of nodes(container["media:thumbnail"])) candidates.push(attr(thumb, "url"));
    for (const media of nodes(container["media:content"])) {
      const isImage = attr(media, "medium") === "image" || (attr(media, "type") ?? "").startsWith("image/");
      if (isImage) candidates.push(attr(media, "url"));
    }
  }

  const itunes = asNode(item["itunes:image"]);
  if (itunes) candidates.push(attr(itunes, "href"));

  for (const candidate of candidates) {
    const safe = toSafeHttpUrl(candidate, baseUrl);
    if (safe) return safe;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Cleaning and limits
// ---------------------------------------------------------------------------

/** Removes duplicate URLs and IDs, sorts newest first, keeps at most `maxItems`. */
function finalizeItems(items: FeedItem[], maxItems: number): FeedItem[] {
  const seenIds = new Set<string>();
  const unique = removeDuplicateUrls(items).filter((item) => {
    if (seenIds.has(item.id)) return false;
    seenIds.add(item.id);
    return true;
  });

  // Newest first. Items without a date keep their original order, at the end.
  const sorted = unique
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const timeA = a.item.publishedAt ? Date.parse(a.item.publishedAt) : -Infinity;
      const timeB = b.item.publishedAt ? Date.parse(b.item.publishedAt) : -Infinity;
      if (timeA === timeB) return a.index - b.index;
      return timeB - timeA;
    })
    .map(({ item }) => item);

  return sorted.slice(0, maxItems);
}

/** Plain, single-line text with a length limit (for titles, authors, etc.). */
function cleanText(value: unknown, maxLength: number): string {
  return truncate(normalizeWhitespace(htmlToText(text(value))), maxLength);
}

/** Cleans category names: plain text, no duplicates (ignoring case), max 20. */
function cleanCategories(values: string[]): string[] | undefined {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const name = cleanText(value, FEED_LIMITS.maxCategoryLength);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
    if (result.length === FEED_LIMITS.maxCategories) break;
  }
  return result.length > 0 ? result : undefined;
}

/**
 * Keeps the raw feed HTML so the reader view can show links and formatting.
 * Returned UNSANITIZED on purpose: the parser never renders it. The browser
 * sanitizes it with DOMPurify (lib/sanitize-html.ts) right before display.
 * Returns undefined for plain text (no tags) or very large content.
 */
function keepHtml(content: string): string | undefined {
  if (!content || content.length > FEED_LIMITS.maxContentHtmlLength) return undefined;
  return /<[a-z][^>]*>/i.test(content) ? content : undefined;
}

function clampMaxItems(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return FEED_LIMITS.maxItems;
  return Math.min(FEED_LIMITS.maxItems, Math.max(1, Math.floor(value)));
}

// ---------------------------------------------------------------------------
// Small helpers for the unknown-shaped XML tree
// ---------------------------------------------------------------------------

/** Text inside a node: a plain string, or the "#text" of { "#text": "...", "@_attr": "..." }. */
function text(node: unknown): string {
  const direct = toSafeString(node);
  if (direct) return direct.trim();
  const obj = asNode(node);
  return obj ? toSafeString(obj["#text"]).trim() : "";
}

/** First non-empty text in a value that may be repeated. */
function firstText(node: unknown): string {
  for (const value of asArray(node)) {
    const t = text(value);
    if (t) return t;
  }
  return "";
}

function attr(node: XmlNode, name: string): string | undefined {
  const value = toSafeString(node[`@_${name}`]).trim();
  return value || undefined;
}

function asNode(value: unknown): XmlNode | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as XmlNode) : undefined;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Only the object nodes of a single-or-repeated value. */
function nodes(value: unknown): XmlNode[] {
  return asArray(value)
    .map(asNode)
    .filter((node): node is XmlNode => node !== undefined);
}

/** All values (objects or plain strings) of a single-or-repeated value. */
function nodesOrText(value: unknown): unknown[] {
  return asArray(value);
}

/** Recursively removes "prefix:" from element names (not from attributes). */
function stripPrefix(value: unknown, prefix: string): unknown {
  if (Array.isArray(value)) return value.map((v) => stripPrefix(v, prefix));
  const node = asNode(value);
  if (!node) return value;
  const result: XmlNode = {};
  for (const [key, child] of Object.entries(node)) {
    const name = key.startsWith(`${prefix}:`) ? key.slice(prefix.length + 1) : key;
    result[name] = stripPrefix(child, prefix);
  }
  return result;
}
