// Tests for lib/feed-parser.ts and the helpers in lib/utils.ts.
// Run with: npm test
// Numbers in test names match the Stage 2 test list.
import { describe, expect, it } from "vitest";
import { FeedParseError, parseFeedXml, safeParseFeedXml } from "@/lib/feed-parser";
import { createArticleId, normalizeWhitespace, removeDuplicateUrls, toIsoDate, toSafeString } from "@/lib/utils";

const FEED_URL = "https://blog.example.com/feed.xml";

// Unusual whitespace characters, built from code points so they stay visible in this file.
const NBSP = String.fromCharCode(0x00a0);
const LINE_SEP = String.fromCharCode(0x2028);
const ZERO_WIDTH = String.fromCharCode(0x200b);
const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000);

function rss(items: string, channelExtras = "<title>Example Blog</title><link>https://blog.example.com/</link>") {
  return `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:content="http://purl.org/rss/1.0/modules/content/"
    xmlns:media="http://search.yahoo.com/mrss/"
    xmlns:atom="http://www.w3.org/2005/Atom">
    <channel>${channelExtras}${items}</channel>
  </rss>`;
}

function rssItem(n: number, extra = "") {
  return `<item>
    <title>Post ${n}</title>
    <link>https://blog.example.com/post-${n}</link>
    <pubDate>Mon, ${String((n % 28) + 1).padStart(2, "0")} Sep 2026 10:00:00 GMT</pubDate>
    ${extra}
  </item>`;
}

function atom(entries: string, feedExtras = `<title>Atom Blog</title><link rel="alternate" href="https://atom.example.com/"/>`) {
  return `<?xml version="1.0" encoding="utf-8"?>
  <feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">${feedExtras}${entries}</feed>`;
}

function atomEntry(n: number, extra = "") {
  return `<entry>
    <title>Entry ${n}</title>
    <link rel="alternate" type="text/html" href="https://atom.example.com/entry-${n}"/>
    <id>tag:atom.example.com,2026:${n}</id>
    <updated>2026-10-${String(n).padStart(2, "0")}T12:00:00Z</updated>
    ${extra}
  </entry>`;
}

function expectParseError(xml: string, code: string) {
  try {
    parseFeedXml(xml, FEED_URL);
    expect.unreachable("parseFeedXml should have thrown");
  } catch (error) {
    expect(error).toBeInstanceOf(FeedParseError);
    expect((error as FeedParseError).code).toBe(code);
  }
}

describe("parseFeedXml – RSS and Atom basics", () => {
  it("1. parses valid RSS", () => {
    const xml = rss(
      `<item>
        <title>Hello &amp; welcome</title>
        <link>https://blog.example.com/hello</link>
        <description><![CDATA[<p>First <b>post</b> here.</p><script>alert("x")</script>]]></description>
        <dc:creator>Asha</dc:creator>
        <pubDate>Tue, 01 Sep 2026 08:30:00 GMT</pubDate>
        <guid>https://blog.example.com/hello</guid>
      </item>`,
      `<title>Example Blog</title><link>https://blog.example.com/</link><description>Notes about the web</description>`,
    );
    const feed = parseFeedXml(xml, FEED_URL);

    expect(feed).toMatchObject({
      title: "Example Blog",
      description: "Notes about the web",
      siteUrl: "https://blog.example.com/",
      feedUrl: FEED_URL,
    });
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({
      title: "Hello & welcome",
      url: "https://blog.example.com/hello",
      summary: "First post here.",
      author: "Asha",
      publishedAt: "2026-09-01T08:30:00.000Z",
    });
    expect(feed.items[0].summary).not.toContain("alert");
  });

  it("2. parses valid Atom", () => {
    const xml = atom(
      `<entry>
        <title type="html">Atom &lt;em&gt;entry&lt;/em&gt;</title>
        <link rel="alternate" href="https://atom.example.com/entry-1"/>
        <id>tag:atom.example.com,2026:1</id>
        <published>2026-10-01T12:00:00+05:30</published>
        <updated>2026-10-02T09:00:00Z</updated>
        <summary type="html">&lt;p&gt;Summary text&lt;/p&gt;</summary>
      </entry>`,
      `<title>Atom Blog</title><subtitle>An Atom feed</subtitle>
       <link rel="self" href="https://atom.example.com/atom.xml"/>
       <link rel="alternate" href="https://atom.example.com/"/>
       <author><name>Ravi</name></author>`,
    );
    const feed = parseFeedXml(xml, "https://atom.example.com/atom.xml");

    expect(feed).toMatchObject({ title: "Atom Blog", description: "An Atom feed", siteUrl: "https://atom.example.com/" });
    expect(feed.items[0]).toMatchObject({
      title: "Atom entry",
      url: "https://atom.example.com/entry-1",
      summary: "Summary text",
      author: "Ravi", // falls back to the feed-level author
      publishedAt: "2026-10-01T06:30:00.000Z",
      updatedAt: "2026-10-02T09:00:00.000Z",
    });
  });

  it("3. parses multiple RSS items, newest first", () => {
    const feed = parseFeedXml(rss(`${rssItem(1)}${rssItem(3)}${rssItem(2)}`), FEED_URL);
    expect(feed.items.map((i) => i.title)).toEqual(["Post 3", "Post 2", "Post 1"]);
  });

  it("4. parses multiple Atom entries", () => {
    const feed = parseFeedXml(atom(`${atomEntry(1)}${atomEntry(2)}${atomEntry(3)}`), "https://atom.example.com/atom.xml");
    expect(feed.items).toHaveLength(3);
    expect(feed.items.map((i) => i.url)).toEqual([
      "https://atom.example.com/entry-3",
      "https://atom.example.com/entry-2",
      "https://atom.example.com/entry-1",
    ]);
  });

  it("5. selects the correct Atom alternate link", () => {
    const xml = atom(`<entry>
      <title>Links</title>
      <id>tag:x,1</id>
      <link rel="self" href="https://atom.example.com/api/entry-1.json"/>
      <link rel="replies" href="https://atom.example.com/entry-1/comments"/>
      <link rel="alternate" type="application/json" href="https://atom.example.com/entry-1.json"/>
      <link rel="alternate" type="text/html" href="https://atom.example.com/entry-1"/>
    </entry>`);
    expect(parseFeedXml(xml, "https://atom.example.com/atom.xml").items[0].url).toBe("https://atom.example.com/entry-1");
  });
});

describe("parseFeedXml – optional fields and dates", () => {
  it("6. leaves description undefined when it is missing", () => {
    const feed = parseFeedXml(rss(rssItem(1)), FEED_URL);
    expect(feed.description).toBeUndefined();
    expect(feed.items[0].summary).toBe("");
  });

  it("7. leaves author undefined when it is missing", () => {
    expect(parseFeedXml(rss(rssItem(1)), FEED_URL).items[0].author).toBeUndefined();
    expect(parseFeedXml(atom(atomEntry(1)), FEED_URL).items[0].author).toBeUndefined();
  });

  it("8. ignores invalid dates instead of crashing", () => {
    const xml = rss(`
      <item><title>A</title><link>https://blog.example.com/a</link><pubDate>not a date</pubDate></item>
      <item><title>B</title><link>https://blog.example.com/b</link><pubDate>Mon, 99 Foo 0000</pubDate></item>`);
    const items = parseFeedXml(xml, FEED_URL).items;
    expect(items.map((i) => i.publishedAt)).toEqual([undefined, undefined]);
  });

  it("9. converts valid dates to ISO strings (with time zones)", () => {
    const xml = rss(`
      <item><title>A</title><link>https://blog.example.com/a</link><pubDate>Thu, 29 Oct 2026 18:30:00 +0530</pubDate></item>
      <item><title>B</title><link>https://blog.example.com/b</link><dc:date>2026-10-28T10:00:00-04:00</dc:date></item>`);
    const items = parseFeedXml(xml, FEED_URL).items;
    expect(items[0].publishedAt).toBe("2026-10-29T13:00:00.000Z");
    expect(items[1].publishedAt).toBe("2026-10-28T14:00:00.000Z");
  });
});

describe("parseFeedXml – URLs and IDs", () => {
  it("10. removes items with duplicate URLs (including #fragment variants)", () => {
    const xml = rss(`${rssItem(1)}${rssItem(1, "<guid>different-guid</guid>")}
      <item><title>Same</title><link>https://blog.example.com/post-1#comments</link></item>${rssItem(2)}`);
    const urls = parseFeedXml(xml, FEED_URL).items.map((item) => item.url);
    expect(urls).toEqual(["https://blog.example.com/post-2", "https://blog.example.com/post-1"]);
  });

  it("11. resolves relative URLs against the site URL, or the feed URL when there is none", () => {
    const withSite = rss(`<item><title>Rel</title><link>/posts/relative</link></item>`);
    expect(parseFeedXml(withSite, FEED_URL).items[0].url).toBe("https://blog.example.com/posts/relative");

    const noSite = rss(`<item><title>Rel</title><link>post.html</link></item>`, "<title>No link</title>");
    expect(parseFeedXml(noSite, "https://other.example.com/blog/feed.xml").items[0].url).toBe(
      "https://other.example.com/blog/post.html",
    );
  });

  it("12. creates a stable GUID-based ID that survives a URL change", () => {
    const before = rss(`<item><title>A</title><link>https://blog.example.com/old</link><guid isPermaLink="false">post-42</guid></item>`);
    const after = rss(`<item><title>A</title><link>https://blog.example.com/new</link><guid isPermaLink="false">post-42</guid></item>`);
    const idBefore = parseFeedXml(before, FEED_URL).items[0].id;
    expect(parseFeedXml(before, FEED_URL).items[0].id).toBe(idBefore); // same input, same ID
    expect(parseFeedXml(after, FEED_URL).items[0].id).toBe(idBefore); // GUID wins over URL
    expect(idBefore).toBe(createArticleId(FEED_URL, { guid: "post-42" }));
  });

  it("13. creates deterministic fallback IDs in the right priority order", () => {
    const byUrl = createArticleId(FEED_URL, { url: "https://blog.example.com/a" });
    const byTitleDate = createArticleId(FEED_URL, { title: "Hello", publishedAt: "2026-10-01T00:00:00.000Z" });
    const byFallback = createArticleId(FEED_URL, { title: "Hello", fallback: "Some summary" });

    // Deterministic: calling again gives the same IDs.
    expect(createArticleId(FEED_URL, { url: "https://blog.example.com/a" })).toBe(byUrl);
    expect(createArticleId(FEED_URL, { title: "Hello", publishedAt: "2026-10-01T00:00:00.000Z" })).toBe(byTitleDate);
    expect(createArticleId(FEED_URL, { title: "Hello", fallback: "Some summary" })).toBe(byFallback);
    expect(createArticleId(FEED_URL, {})).toBe(createArticleId(FEED_URL, {}));

    // Different sources give different IDs, and the kind is visible.
    expect(new Set([byUrl, byTitleDate, byFallback]).size).toBe(3);
    expect(byTitleDate).toMatch(/-t-/);
    expect(byFallback).toMatch(/-f-/);
    // Different feeds never share an ID.
    expect(createArticleId("https://other.example/feed", { url: "https://blog.example.com/a" })).not.toBe(byUrl);
    // An RSS item without a GUID uses its URL.
    expect(parseFeedXml(rss(rssItem(7)), FEED_URL).items[0].id).toBe(
      createArticleId(FEED_URL, { url: "https://blog.example.com/post-7" }),
    );
  });

  it("14. returns at most 50 articles (and respects a smaller maxItems option)", () => {
    const many = rss(Array.from({ length: 75 }, (_, i) => rssItem(i + 1)).join(""));
    expect(parseFeedXml(many, FEED_URL).items).toHaveLength(50);
    expect(parseFeedXml(many, FEED_URL, { maxItems: 10 }).items).toHaveLength(10);
    expect(parseFeedXml(many, FEED_URL, { maxItems: 500 }).items).toHaveLength(50); // cannot go above 50
  });
});

describe("parseFeedXml – empty, malformed and unsupported input", () => {
  it("15. returns an empty item list for a feed with no items", () => {
    const feed = parseFeedXml(rss(""), FEED_URL);
    expect(feed.title).toBe("Example Blog");
    expect(feed.items).toEqual([]);
    expect(parseFeedXml(atom(""), FEED_URL).items).toEqual([]);
  });

  it("16. rejects empty XML", () => {
    expectParseError("", "INVALID_XML");
    expectParseError("   \n\t ", "INVALID_XML");
  });

  it("17. rejects malformed XML", () => {
    expectParseError("<rss><channel><title>Oops</channel>", "INVALID_XML");
    expectParseError("this is not xml at all <<<", "INVALID_XML");
  });

  it("18. rejects unsupported XML (valid XML that is not RSS or Atom)", () => {
    expectParseError("<html><body><p>Hi</p></body></html>", "UNSUPPORTED_FORMAT");
    expectParseError(`<?xml version="1.0"?><note><to>You</to></note>`, "UNSUPPORTED_FORMAT");
  });

  it("safeParseFeedXml returns a result object instead of throwing", () => {
    expect(safeParseFeedXml("", FEED_URL)).toEqual({ ok: false, code: "INVALID_XML", message: "The feed is empty." });
    const result = safeParseFeedXml(rss(rssItem(1)), FEED_URL);
    expect(result.ok && result.feed.items.length).toBe(1);
  });
});

describe("parseFeedXml – namespaces, categories and images", () => {
  it("19. handles XML namespaces (dc, content, atom:link, and prefixed Atom)", () => {
    const rssXml = rss(
      `<item>
        <title>NS</title>
        <link>https://blog.example.com/ns</link>
        <dc:creator>Priya</dc:creator>
        <dc:date>2026-10-05T00:00:00Z</dc:date>
        <content:encoded><![CDATA[<p>Full content</p>]]></content:encoded>
      </item>`,
      `<title>NS Blog</title><atom:link rel="self" href="https://blog.example.com/feed.xml"/>
       <atom:link rel="alternate" href="https://blog.example.com/"/>`,
    );
    const feed = parseFeedXml(rssXml, FEED_URL);
    expect(feed.siteUrl).toBe("https://blog.example.com/"); // from atom:link, since <link> is missing
    expect(feed.items[0]).toMatchObject({ author: "Priya", summary: "Full content", publishedAt: "2026-10-05T00:00:00.000Z" });

    const prefixedAtom = `<?xml version="1.0"?>
      <atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
        <atom:title>Prefixed</atom:title>
        <atom:entry>
          <atom:title>Inside</atom:title>
          <atom:link href="https://p.example.com/inside"/>
          <atom:id>urn:1</atom:id>
        </atom:entry>
      </atom:feed>`;
    const pFeed = parseFeedXml(prefixedAtom, "https://p.example.com/feed");
    expect(pFeed.title).toBe("Prefixed");
    expect(pFeed.items[0]).toMatchObject({ title: "Inside", url: "https://p.example.com/inside" });
  });

  it("20. reads RSS and Atom categories (plain text, no duplicates)", () => {
    const rssXml = rss(rssItem(1, `<category>Web</category><category domain="x">Privacy</category><category>web</category><dc:subject>RSS</dc:subject>`));
    expect(parseFeedXml(rssXml, FEED_URL).items[0].categories).toEqual(["Web", "Privacy", "RSS"]);

    const atomXml = atom(atomEntry(1, `<category term="indieweb" label="IndieWeb"/><category term="feeds"/>`));
    expect(parseFeedXml(atomXml, FEED_URL).items[0].categories).toEqual(["IndieWeb", "feeds"]);

    expect(parseFeedXml(rss(rssItem(2)), FEED_URL).items[0].categories).toBeUndefined();
  });

  it("21. extracts media image URLs from several places", () => {
    const xml = rss(`
      ${rssItem(1, `<enclosure url="https://cdn.example.com/1.jpg" type="image/jpeg" length="1"/>`)}
      ${rssItem(2, `<media:thumbnail url="https://cdn.example.com/2.jpg"/>`)}
      ${rssItem(3, `<media:content url="/img/3.png" medium="image"/>`)}
      ${rssItem(4, `<media:group><media:content url="https://cdn.example.com/4.webp" type="image/webp"/></media:group>`)}
      ${rssItem(5, `<enclosure url="https://cdn.example.com/5.mp3" type="audio/mpeg" length="1"/>`)}`);
    const images = Object.fromEntries(parseFeedXml(xml, FEED_URL).items.map((i) => [i.title, i.imageUrl]));
    expect(images).toEqual({
      "Post 1": "https://cdn.example.com/1.jpg",
      "Post 2": "https://cdn.example.com/2.jpg",
      "Post 3": "https://blog.example.com/img/3.png", // relative URL resolved
      "Post 4": "https://cdn.example.com/4.webp",
      "Post 5": undefined, // audio is not an image
    });

    const atomXml = atom(atomEntry(1, `<link rel="enclosure" type="image/png" href="https://cdn.example.com/a.png"/>`));
    expect(parseFeedXml(atomXml, FEED_URL).items[0].imageUrl).toBe("https://cdn.example.com/a.png");
  });

  it("22. rejects unsafe image protocols and keeps looking for a safe one", () => {
    const xml = rss(`
      ${rssItem(1, `<media:thumbnail url="javascript:alert(1)"/>`)}
      ${rssItem(2, `<media:thumbnail url="data:image/png;base64,AAAA"/><media:content url="https://cdn.example.com/ok.jpg" medium="image"/>`)}
      ${rssItem(3, `<enclosure url="file:///etc/passwd" type="image/png" length="1"/>`)}`);
    const images = Object.fromEntries(parseFeedXml(xml, FEED_URL).items.map((i) => [i.title, i.imageUrl]));
    expect(images).toEqual({ "Post 1": undefined, "Post 2": "https://cdn.example.com/ok.jpg", "Post 3": undefined });
  });
});

describe("parseFeedXml – untrusted and unusual content", () => {
  it("23. normalizes unusual whitespace", () => {
    const messyTitle = `  Hello\t\t${NBSP}${NBSP}World${LINE_SEP}again${ZERO_WIDTH}!${IDEOGRAPHIC_SPACE}  `;
    const xml = rss(
      `<item><title>${messyTitle}</title><link>  https://blog.example.com/ws  </link>
       <description><![CDATA[<p>One
       two${NBSP}three</p><p>Four</p>]]></description></item>`,
      `<title>\n   Spaced\n   Blog   </title><link>https://blog.example.com/</link>`,
    );
    const feed = parseFeedXml(xml, FEED_URL);
    expect(feed.title).toBe("Spaced Blog");
    expect(feed.items[0].title).toBe("Hello World again!");
    expect(feed.items[0].url).toBe("https://blog.example.com/ws");
    expect(feed.items[0].summary).toBe("One two three\n\nFour"); // paragraphs kept, raw line breaks are spaces
  });

  it("24. skips articles without a usable link (missing, empty or unsafe)", () => {
    const xml = rss(`
      <item><title>No link at all</title></item>
      <item><title>Empty link</title><link>   </link></item>
      <item><title>Unsafe link</title><link>javascript:alert(1)</link></item>
      <item><title>Non-permalink guid</title><guid isPermaLink="false">abc-123</guid></item>
      <item><title>Permalink guid only</title><guid>https://blog.example.com/from-guid</guid></item>
      ${rssItem(1)}`);
    const items = parseFeedXml(xml, FEED_URL).items;
    expect(items.map((i) => i.title)).toEqual(["Post 1", "Permalink guid only"]);
    expect(items[1].url).toBe("https://blog.example.com/from-guid");
    // Atom entry without an alternate link
    expect(parseFeedXml(atom(`<entry><title>x</title><id>1</id><link rel="self" href="https://a.example/x.json"/></entry>`), FEED_URL).items).toEqual([]);
  });

  it("25. limits oversized fields and rejects XML over 2 MB", () => {
    const longTitle = "T".repeat(800);
    const longAuthor = "A".repeat(600);
    const longSummary = "word ".repeat(5000); // 25,000 characters
    const manyCategories = Array.from({ length: 30 }, (_, i) => `<category>Tag ${i}</category>`).join("");
    const xml = rss(
      rssItem(1, `<dc:creator>${longAuthor}</dc:creator><description>${longSummary}</description>${manyCategories}`).replace("Post 1", longTitle),
      `<title>${longTitle}</title><link>https://blog.example.com/</link>`,
    );
    const feed = parseFeedXml(xml, FEED_URL);
    const [item] = feed.items;

    expect(feed.title.length).toBe(500);
    expect(item.title.length).toBe(500);
    expect(item.title.endsWith("…")).toBe(true);
    expect(item.author?.length).toBe(300);
    expect(item.summary.length).toBeLessThanOrEqual(10_000);
    expect(item.categories).toHaveLength(20);

    const huge = rss(`<item><title>x</title><link>https://blog.example.com/x</link><description>${"x".repeat(2 * 1024 * 1024)}</description></item>`);
    expectParseError(huge, "RESPONSE_TOO_LARGE");
  });

  it("never returns script content or unsafe protocols anywhere in the output", () => {
    const xml = rss(
      `<item>
        <title><![CDATA[<script>alert(1)</script>Safe title]]></title>
        <link>https://blog.example.com/s</link>
        <description><![CDATA[<img src=x onerror=alert(1)>Text<script>steal()</script>]]></description>
        <media:thumbnail url="javascript:alert(1)"/>
      </item>`,
      `<title>Blog</title><link>javascript:alert(1)</link>`,
    );
    const feed = parseFeedXml(xml, FEED_URL);
    const { contentHtml, ...plainFields } = feed.items[0];
    const output = JSON.stringify({ ...feed, items: [plainFields] });

    expect(output).not.toMatch(/script|alert|onerror|steal|javascript:/i);
    expect(feed.siteUrl).toBeUndefined();
    expect(feed.items[0].title).toBe("Safe title");
    // contentHtml is the raw HTML on purpose; it is only shown after DOMPurify.
    expect(contentHtml).toContain("<script>");
  });
});

describe("utils helpers", () => {
  it("toSafeString converts only simple values", () => {
    expect(toSafeString("a")).toBe("a");
    expect(toSafeString(12)).toBe("12");
    expect(toSafeString(true)).toBe("true");
    expect(toSafeString(Number.NaN)).toBe("");
    expect(toSafeString({ a: 1 })).toBe("");
    expect(toSafeString(null)).toBe("");
    expect(toSafeString(undefined)).toBe("");
  });

  it("normalizeWhitespace collapses every kind of whitespace", () => {
    expect(normalizeWhitespace(`\n a${NBSP}b\t${LINE_SEP}c${ZERO_WIDTH}d `)).toBe("a b cd");
  });

  it("removeDuplicateUrls keeps the first of each URL", () => {
    const items = [{ url: "https://a.example/1" }, { url: "https://a.example/1#top" }, { url: "https://a.example/2" }];
    expect(removeDuplicateUrls(items)).toEqual([{ url: "https://a.example/1" }, { url: "https://a.example/2" }]);
  });

  it("toIsoDate rejects impossible dates", () => {
    expect(toIsoDate("2026-10-29")).toBe("2026-10-29T00:00:00.000Z");
    expect(toIsoDate("")).toBeUndefined();
    expect(toIsoDate("yesterday")).toBeUndefined();
    expect(toIsoDate("0001-01-01T00:00:00Z")).toBeUndefined();
    expect(toIsoDate("9999-01-01T00:00:00Z")).toBeUndefined();
  });
});

describe("parseFeed – keeping HTML links (regression: NASA Spanish feed)", () => {
  // Same structure as https://www.nasa.gov/es/feed/ : the link exists only in
  // <content:encoded>; <description> has the same sentence as plain text.
  const nasaLike = rss(
    `<item>
      <title>Envía tu nombre a Titán</title>
      <link>https://www.nasa.gov/es/news-release/envia-tu-nombre/</link>
      <description><![CDATA[Read this release in English here.]]></description>
      <content:encoded><![CDATA[<p><em>Read this release in English <a href="https://www.nasa.gov/news-release/send-your-name-to-titan-aboard-nasas-dragonfly-mission/">here</a>. </em></p>]]></content:encoded>
    </item>`,
  );

  it("keeps the hyperlink in contentHtml while summary stays plain text", () => {
    const [item] = parseFeedXml(nasaLike, "https://www.nasa.gov/es/feed/").items;
    expect(item.summary).toBe("Read this release in English here.");
    expect(item.contentHtml).toContain(
      '<a href="https://www.nasa.gov/news-release/send-your-name-to-titan-aboard-nasas-dragonfly-mission/">here</a>',
    );
  });

  it("keeps HTML from entity-escaped descriptions and Atom content", () => {
    const escaped = rss(rssItem(1, `<description>See &lt;a href="/about"&gt;about&lt;/a&gt;</description>`));
    expect(parseFeedXml(escaped, FEED_URL).items[0].contentHtml).toBe('See <a href="/about">about</a>');

    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>A</title><entry><title>E</title>
      <link href="https://a.example/e"/><content type="html">&lt;p&gt;Go &lt;a href="https://b.example/"&gt;there&lt;/a&gt;&lt;/p&gt;</content></entry></feed>`;
    expect(parseFeedXml(atom, "https://a.example/feed").items[0].contentHtml).toBe('<p>Go <a href="https://b.example/">there</a></p>');
  });

  it("sets no contentHtml when the feed only has plain text", () => {
    const plain = rss(rssItem(1, "<description>Just words, no tags.</description>"));
    const [item] = parseFeedXml(plain, FEED_URL).items;
    expect(item.summary).toBe("Just words, no tags.");
    expect(item.contentHtml).toBeUndefined();
  });
});
