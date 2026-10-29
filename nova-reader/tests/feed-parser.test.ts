// Tests for lib/feed-parser.ts. Run with: npm test
import { describe, expect, it } from "vitest";
import { FeedParseError, parseFeed } from "@/lib/feed-parser";

const FEED_URL = "https://blog.example.com/feed.xml";

function rss(items: string, channelExtras = "<title>Example Blog</title><link>https://blog.example.com/</link>") {
  return `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
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

describe("parseFeed – RSS 2.0", () => {
  it("parses a valid RSS feed", () => {
    const xml = rss(
      `<item>
        <title>Hello &amp; welcome</title>
        <link>https://blog.example.com/hello</link>
        <description><![CDATA[<p>First <b>post</b> here.</p><script>alert("x")</script>]]></description>
        <dc:creator>Asha</dc:creator>
        <pubDate>Tue, 01 Sep 2026 08:30:00 GMT</pubDate>
        <guid>https://blog.example.com/hello</guid>
        <enclosure url="https://blog.example.com/cover.jpg" type="image/jpeg" length="1"/>
      </item>`,
      `<title>Example Blog</title><link>https://blog.example.com/</link><description>Notes about the web</description>`,
    );

    const feed = parseFeed(xml, FEED_URL);

    expect(feed.title).toBe("Example Blog");
    expect(feed.description).toBe("Notes about the web");
    expect(feed.siteUrl).toBe("https://blog.example.com/");
    expect(feed.feedUrl).toBe(FEED_URL);
    expect(feed.items).toHaveLength(1);

    const [item] = feed.items;
    expect(item.title).toBe("Hello & welcome");
    expect(item.url).toBe("https://blog.example.com/hello");
    expect(item.summary).toBe("First post here.");
    expect(item.summary).not.toContain("alert");
    expect(item.author).toBe("Asha");
    expect(item.publishedAt).toBe("2026-09-01T08:30:00.000Z");
    expect(item.imageUrl).toBe("https://blog.example.com/cover.jpg");
    expect(item.id).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
  });

  it("creates the same ID every time for the same article", () => {
    const xml = rss(rssItem(1));
    expect(parseFeed(xml, FEED_URL).items[0].id).toBe(parseFeed(xml, FEED_URL).items[0].id);
  });

  it("prefers full content:encoded over a short description", () => {
    const xml = rss(rssItem(1, `<description>Short</description><content:encoded><![CDATA[<p>Long full text</p>]]></content:encoded>`));
    expect(parseFeed(xml, FEED_URL).items[0].summary).toBe("Long full text");
  });
});

describe("parseFeed – Atom", () => {
  it("parses a valid Atom feed", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Atom Blog</title>
      <subtitle>An Atom feed</subtitle>
      <link rel="self" href="https://atom.example.com/atom.xml"/>
      <link rel="alternate" href="https://atom.example.com/"/>
      <author><name>Ravi</name></author>
      <entry>
        <title type="html">Atom &lt;em&gt;entry&lt;/em&gt;</title>
        <link rel="alternate" href="https://atom.example.com/entry-1"/>
        <id>tag:atom.example.com,2026:1</id>
        <published>2026-10-01T12:00:00+05:30</published>
        <summary type="html">&lt;p&gt;Summary text&lt;/p&gt;</summary>
      </entry>
    </feed>`;

    const feed = parseFeed(xml, "https://atom.example.com/atom.xml");

    expect(feed.title).toBe("Atom Blog");
    expect(feed.description).toBe("An Atom feed");
    expect(feed.siteUrl).toBe("https://atom.example.com/");
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({
      title: "Atom entry",
      url: "https://atom.example.com/entry-1",
      summary: "Summary text",
      author: "Ravi", // falls back to the feed-level author
      publishedAt: "2026-10-01T06:30:00.000Z",
    });
  });
});

describe("parseFeed – edge cases", () => {
  it("returns an empty item list for a feed with no items", () => {
    const feed = parseFeed(rss(""), FEED_URL);
    expect(feed.title).toBe("Example Blog");
    expect(feed.items).toEqual([]);
  });

  it("uses fallback text when titles are missing", () => {
    const xml = rss(`<item><link>https://blog.example.com/no-title</link></item>`, "<link>https://blog.example.com/</link>");
    const feed = parseFeed(xml, FEED_URL);
    expect(feed.title).toBe("Untitled feed");
    expect(feed.items[0].title).toBe("Untitled article");
  });

  it("leaves description undefined when it is missing", () => {
    const feed = parseFeed(rss(rssItem(1)), FEED_URL);
    expect(feed.description).toBeUndefined();
    expect(feed.items[0].summary).toBe("");
    expect(feed.items[0].author).toBeUndefined();
  });

  it("removes items with duplicate links", () => {
    const xml = rss(`${rssItem(1)}${rssItem(1, "<guid>different-guid</guid>")}${rssItem(2)}`);
    const urls = parseFeed(xml, FEED_URL).items.map((item) => item.url);
    expect(urls).toHaveLength(2);
    expect(new Set(urls).size).toBe(2);
  });

  it("throws INVALID_XML for broken XML", () => {
    expect(() => parseFeed("<rss><channel><title>Oops</channel>", FEED_URL)).toThrow(FeedParseError);
    try {
      parseFeed("<rss><channel><title>Oops</channel>", FEED_URL);
    } catch (error) {
      expect((error as FeedParseError).code).toBe("INVALID_XML");
    }
  });

  it("throws INVALID_XML for an empty response", () => {
    expect(() => parseFeed("   ", FEED_URL)).toThrow(FeedParseError);
  });

  it("throws UNSUPPORTED_FORMAT for XML that is not a feed (e.g. a web page)", () => {
    try {
      parseFeed("<html><body><p>Hi</p></body></html>", FEED_URL);
      expect.unreachable();
    } catch (error) {
      expect((error as FeedParseError).code).toBe("UNSUPPORTED_FORMAT");
    }
  });

  it("ignores invalid dates instead of crashing", () => {
    const xml = rss(`<item><title>A</title><link>https://blog.example.com/a</link><pubDate>not a date</pubDate></item>`);
    expect(parseFeed(xml, FEED_URL).items[0].publishedAt).toBeUndefined();
  });

  it("resolves relative URLs against the site URL", () => {
    const xml = rss(`<item><title>Rel</title><link>/posts/relative</link></item>`);
    expect(parseFeed(xml, FEED_URL).items[0].url).toBe("https://blog.example.com/posts/relative");
  });

  it("resolves relative URLs against the feed URL when the site link is missing", () => {
    const xml = rss(`<item><title>Rel</title><link>post.html</link></item>`, "<title>No link</title>");
    expect(parseFeed(xml, "https://other.example.com/blog/feed.xml").items[0].url).toBe(
      "https://other.example.com/blog/post.html",
    );
  });

  it("drops items whose link is not http(s), such as javascript:", () => {
    const xml = rss(`<item><title>Bad</title><link>javascript:alert(1)</link></item>${rssItem(1)}`);
    const items = parseFeed(xml, FEED_URL).items;
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe("https://blog.example.com/post-1");
  });

  it("returns at most 50 items, newest first", () => {
    const many = Array.from({ length: 75 }, (_, i) => rssItem(i + 1)).join("");
    const items = parseFeed(rss(many), FEED_URL).items;
    expect(items).toHaveLength(50);
    const times = items.map((item) => Date.parse(item.publishedAt ?? ""));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});
