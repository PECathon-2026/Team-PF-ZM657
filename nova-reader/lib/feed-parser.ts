// RSS + Atom parser.
// Turns raw feed XML text into our simple `Feed` type.
//
// Where it runs: currently on the SERVER (called by app/api/feed/route.ts).
// It is a pure function with no Node-only code, so it can later be moved to the
// browser without changes (PECathon PS-003 asks for browser-side parsing).
//
// Safety: the parser only produces plain strings. Feed HTML is converted to
// text and links are checked to be http(s), so nothing from a feed can run as code.

import { XMLParser, XMLValidator } from "fast-xml-parser";
import { MAX_FEED_ITEMS, type Feed, type FeedItem } from "./feed-types";
import { hashString, htmlToText, toIsoDate, toSafeHttpUrl, truncate } from "./utils";

const MAX_TITLE_LENGTH = 300;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_SUMMARY_LENGTH = 10_000;

/** Error thrown when the XML is broken or is not RSS/Atom. */
export class FeedParseError extends Error {
  constructor(
    public readonly code: "INVALID_XML" | "UNSUPPORTED_FORMAT",
    message: string,
  ) {
    super(message);
    this.name = "FeedParseError";
  }
}

// Parsed XML is a tree of unknown shape, so we treat every node as `unknown`
// and check it before use. (This is why we do not need `any`.)
type XmlNode = Record<string, unknown>;

// Tags that can appear more than once. Forcing them to be arrays means
// "one item" and "many items" look the same to our code.
const ARRAY_TAGS = new Set(["item", "entry", "link", "author", "category", "media:content", "media:thumbnail"]);

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false, // keep everything as strings
  parseAttributeValue: false,
  trimValues: true,
  // Entity expansion is limited by fast-xml-parser's defaults, which protects
  // against "billion laughs" style XML bombs.
  processEntities: true,
  isArray: (tagName) => ARRAY_TAGS.has(tagName),
});

/**
 * Main entry point.
 * @param xml     The raw feed text downloaded from the internet.
 * @param feedUrl The URL the feed came from. Used to resolve relative links.
 * @throws FeedParseError when the XML is invalid or not a feed.
 */
export function parseFeed(xml: string, feedUrl: string): Feed {
  const tree = parseXml(xml);

  const rss = asNode(tree["rss"]);
  if (rss) return parseRss(asNode(rss["channel"]) ?? {}, feedUrl);

  const rdf = asNode(tree["rdf:RDF"]); // RSS 1.0, still used by some blogs
  if (rdf) return parseRss({ ...(asNode(rdf["channel"]) ?? {}), item: rdf["item"] }, feedUrl);

  const atom = asNode(tree["feed"]);
  if (atom) return parseAtom(atom, feedUrl);

  throw new FeedParseError("UNSUPPORTED_FORMAT", "This URL did not return an RSS or Atom feed.");
}

function parseXml(xml: string): XmlNode {
  const trimmed = xml.trim().replace(/^﻿/, ""); // remove byte-order mark
  if (!trimmed) throw new FeedParseError("INVALID_XML", "The feed is empty.");

  const validation = XMLValidator.validate(trimmed);
  if (validation !== true) {
    throw new FeedParseError("INVALID_XML", "The feed is not valid XML.");
  }
  try {
    return xmlParser.parse(trimmed) as XmlNode;
  } catch {
    throw new FeedParseError("INVALID_XML", "The feed could not be read.");
  }
}

// ---------------------------------------------------------------------------
// RSS 2.0 (and RSS 1.0)
// ---------------------------------------------------------------------------

function parseRss(channel: XmlNode, feedUrl: string): Feed {
  const siteUrl = toSafeHttpUrl(firstText(channel["link"]), feedUrl);
  const baseUrl = siteUrl ?? feedUrl;

  const items = asArray(channel["item"])
    .map(asNode)
    .filter((node): node is XmlNode => node !== undefined)
    .map((item) => parseRssItem(item, baseUrl, feedUrl))
    .filter((item): item is FeedItem => item !== undefined);

  return {
    title: cleanTitle(text(channel["title"])) || "Untitled feed",
    description: cleanDescription(text(channel["description"])),
    siteUrl,
    feedUrl,
    items: finalizeItems(items),
  };
}

function parseRssItem(item: XmlNode, baseUrl: string, feedUrl: string): FeedItem | undefined {
  const guid = text(item["guid"]);
  // Some feeds only put the link in <guid>, so try it as a fallback.
  const url = toSafeHttpUrl(firstText(item["link"]), baseUrl) ?? toSafeHttpUrl(guid, baseUrl);
  if (!url) return undefined; // without a link, there is nothing to open

  const title = cleanTitle(text(item["title"])) || "Untitled article";
  const content = text(item["content:encoded"]) || text(item["description"]);

  return {
    id: makeId(feedUrl, guid || url),
    title,
    url,
    summary: truncate(htmlToText(content), MAX_SUMMARY_LENGTH),
    author: cleanOptional(text(item["dc:creator"]) || text(firstOf(item["author"]))),
    publishedAt: toIsoDate(text(item["pubDate"]) || text(item["dc:date"])),
    imageUrl: findRssImage(item, baseUrl),
  };
}

function findRssImage(item: XmlNode, baseUrl: string): string | undefined {
  const enclosure = asNode(item["enclosure"]);
  if (enclosure && String(enclosure["@_type"] ?? "").startsWith("image/")) {
    const url = toSafeHttpUrl(attr(enclosure, "url"), baseUrl);
    if (url) return url;
  }
  for (const tag of ["media:thumbnail", "media:content"]) {
    for (const node of asArray(item[tag]).map(asNode)) {
      if (!node) continue;
      const medium = attr(node, "medium");
      const type = attr(node, "type") ?? "";
      if (tag === "media:content" && medium !== "image" && !type.startsWith("image/")) continue;
      const url = toSafeHttpUrl(attr(node, "url"), baseUrl);
      if (url) return url;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Atom
// ---------------------------------------------------------------------------

function parseAtom(feed: XmlNode, feedUrl: string): Feed {
  const siteUrl = toSafeHttpUrl(findAtomLink(feed["link"], "alternate"), feedUrl);
  const baseUrl = siteUrl ?? feedUrl;
  const feedAuthor = atomAuthorName(feed["author"]);

  const items = asArray(feed["entry"])
    .map(asNode)
    .filter((node): node is XmlNode => node !== undefined)
    .map((entry) => parseAtomEntry(entry, baseUrl, feedUrl, feedAuthor))
    .filter((item): item is FeedItem => item !== undefined);

  return {
    title: cleanTitle(text(feed["title"])) || "Untitled feed",
    description: cleanDescription(text(feed["subtitle"])),
    siteUrl,
    feedUrl,
    items: finalizeItems(items),
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

  const atomId = text(entry["id"]);
  const content = text(entry["content"]) || text(entry["summary"]);

  return {
    id: makeId(feedUrl, atomId || url),
    title: cleanTitle(text(entry["title"])) || "Untitled article",
    url,
    summary: truncate(htmlToText(content), MAX_SUMMARY_LENGTH),
    author: atomAuthorName(entry["author"]) ?? feedAuthor,
    publishedAt: toIsoDate(text(entry["published"]) || text(entry["updated"])),
    imageUrl: findAtomImage(entry, baseUrl),
  };
}

/** Atom links look like <link rel="alternate" href="..."/>. A missing rel means "alternate". */
function findAtomLink(links: unknown, rel: string): string | undefined {
  const nodes = asArray(links).map(asNode).filter((n): n is XmlNode => n !== undefined);
  const match = nodes.find((n) => (attr(n, "rel") ?? "alternate") === rel) ?? nodes.find((n) => !attr(n, "rel"));
  return match ? attr(match, "href") : undefined;
}

function findAtomImage(entry: XmlNode, baseUrl: string): string | undefined {
  const links = asArray(entry["link"]).map(asNode);
  for (const link of links) {
    if (link && attr(link, "rel") === "enclosure" && (attr(link, "type") ?? "").startsWith("image/")) {
      return toSafeHttpUrl(attr(link, "href"), baseUrl);
    }
  }
  const thumb = asNode(firstOf(entry["media:thumbnail"]));
  return thumb ? toSafeHttpUrl(attr(thumb, "url"), baseUrl) : undefined;
}

function atomAuthorName(authors: unknown): string | undefined {
  const author = asNode(firstOf(authors));
  return author ? cleanOptional(text(author["name"])) : cleanOptional(text(firstOf(authors)));
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Removes duplicate URLs, sorts newest first, and keeps at most 50 items. */
function finalizeItems(items: FeedItem[]): FeedItem[] {
  const seenUrls = new Set<string>();
  const seenIds = new Set<string>();
  const unique = items.filter((item) => {
    if (seenUrls.has(item.url) || seenIds.has(item.id)) return false;
    seenUrls.add(item.url);
    seenIds.add(item.id);
    return true;
  });

  // Newest first. Items without a date keep their original order at the end.
  const sorted = unique
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const timeA = a.item.publishedAt ? Date.parse(a.item.publishedAt) : -Infinity;
      const timeB = b.item.publishedAt ? Date.parse(b.item.publishedAt) : -Infinity;
      if (timeA === timeB) return a.index - b.index;
      return timeB - timeA;
    })
    .map(({ item }) => item);

  return sorted.slice(0, MAX_FEED_ITEMS);
}

/** Same feed + same article always gives the same ID, so saved articles match. */
function makeId(feedUrl: string, key: string): string {
  return `${hashString(feedUrl)}-${hashString(key)}`;
}

/** Gets the text inside a node, whether it is a plain string or { "#text": "..." }. */
function text(node: unknown): string {
  if (typeof node === "string") return node.trim();
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  const obj = asNode(node);
  if (obj && typeof obj["#text"] === "string") return obj["#text"].trim();
  return "";
}

/** Text of the first plain-text value in a possibly repeated tag. */
function firstText(node: unknown): string {
  for (const value of asArray(node)) {
    const t = text(value);
    if (t) return t;
  }
  return "";
}

function attr(node: XmlNode, name: string): string | undefined {
  const value = node[`@_${name}`];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNode(value: unknown): XmlNode | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as XmlNode) : undefined;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function firstOf(value: unknown): unknown {
  return asArray(value)[0];
}

function cleanTitle(value: string): string {
  return truncate(htmlToText(value).replace(/\s+/g, " "), MAX_TITLE_LENGTH);
}

function cleanDescription(value: string): string | undefined {
  const cleaned = truncate(htmlToText(value).replace(/\s+/g, " "), MAX_DESCRIPTION_LENGTH);
  return cleaned || undefined;
}

function cleanOptional(value: string): string | undefined {
  const cleaned = htmlToText(value).replace(/\s+/g, " ").trim();
  return cleaned ? truncate(cleaned, MAX_TITLE_LENGTH) : undefined;
}
