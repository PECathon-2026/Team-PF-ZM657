// Tests for lib/server/feed-fetcher.ts (shared secure download loop).
// Fake DNS + network only; the real SSRF pin still runs via fakeInternet.
import { describe, expect, it } from "vitest";
import { FeedRouteError } from "@/lib/server/errors";
import {
  assertArticleContentType,
  assertFeedContentType,
  decodeBody,
  fetchFeedXml,
  fetchTextSafely,
} from "@/lib/server/feed-fetcher";
import { fakeInternet } from "./helpers/fake-internet";

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title></channel></rss>`;
const HTML = "<!doctype html><html><body><article><p>Hello</p></article></body></html>";

function feedOpts(net: ReturnType<typeof fakeInternet>) {
  return { resolver: net.resolver, transport: net.transport, timeoutMs: 1000 };
}

describe("fetchFeedXml – success", () => {
  it("returns XML text and the final URL", async () => {
    const net = fakeInternet({
      "https://mock.example/feed.xml": {
        body: Buffer.from(RSS),
        headers: { "content-type": "application/rss+xml; charset=utf-8" },
      },
    });
    const result = await fetchFeedXml("https://mock.example/feed.xml", feedOpts(net));
    expect(result.xml).toContain("<rss");
    expect(result.finalUrl).toBe("https://mock.example/feed.xml");
    expect(net.seenOptions[0]?.headers?.Accept).toContain("application/rss+xml");
  });

  it("follows a relative redirect", async () => {
    const net = fakeInternet({
      "https://mock.example/old": { status: 302, headers: { location: "/new.xml" }, body: Buffer.alloc(0) },
      "https://mock.example/new.xml": {
        body: Buffer.from(RSS),
        headers: { "content-type": "application/xml" },
      },
    });
    const result = await fetchFeedXml("https://mock.example/old", feedOpts(net));
    expect(result.finalUrl).toBe("https://mock.example/new.xml");
    expect(result.xml).toContain("<rss");
  });
});

describe("fetchFeedXml – invalid input and upstream errors", () => {
  it("rejects a missing or unsafe URL before connecting", async () => {
    const net = fakeInternet({});
    await expect(fetchFeedXml("", feedOpts(net))).rejects.toBeInstanceOf(FeedRouteError);
    await expect(fetchFeedXml("ftp://mock.example/feed", feedOpts(net))).rejects.toMatchObject({ code: "UNSUPPORTED_PROTOCOL" });
    await expect(fetchFeedXml("http://127.0.0.1/feed", feedOpts(net))).rejects.toMatchObject({ code: "BLOCKED_HOST" });
    expect(net.requested).toEqual([]);
  });

  it("maps oversized, timeout and connection errors to feed wording", async () => {
    await expect(
      fetchFeedXml("https://mock.example/feed", {
        ...feedOpts(
          fakeInternet({
            "https://mock.example/feed": async () => {
              throw new FeedRouteError("RESPONSE_TOO_LARGE", 413, "The feed is too large (limit is 2 MB).");
            },
          }),
        ),
      }),
    ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE", message: "The feed is too large (limit is 2 MB)." });

    await expect(
      fetchFeedXml("https://mock.example/feed", {
        ...feedOpts(
          fakeInternet({
            "https://mock.example/feed": async () => {
              throw new FeedRouteError("TIMEOUT", 504, "The feed took too long to respond.");
            },
          }),
        ),
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT", message: "The feed took too long to respond." });

    await expect(
      fetchFeedXml("https://mock.example/feed", {
        ...feedOpts(
          fakeInternet({
            "https://mock.example/feed": async () => {
              throw new FeedRouteError("FETCH_FAILED", 502, "Could not connect to the feed's website.");
            },
          }),
        ),
      }),
    ).rejects.toMatchObject({ code: "FETCH_FAILED", message: "Could not connect to the feed's website." });
  });

  it("wraps unexpected transport errors without leaking details", async () => {
    await expect(
      fetchFeedXml("https://mock.example/feed", {
        ...feedOpts(
          fakeInternet({
            "https://mock.example/feed": async () => {
              throw new Error("ECONNREFUSED 10.0.0.1:443 secret=/etc/passwd");
            },
          }),
        ),
      }),
    ).rejects.toMatchObject({
      code: "FETCH_FAILED",
      status: 502,
      message: "Could not connect to the feed's website.",
    });
  });

  it("treats AbortError as a timeout", async () => {
    await expect(
      fetchFeedXml("https://mock.example/feed", {
        ...feedOpts(
          fakeInternet({
            "https://mock.example/feed": async () => {
              throw Object.assign(new Error("aborted"), { name: "AbortError" });
            },
          }),
        ),
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT", status: 504 });
  });

  it("rejects HTTP 204 and 206 as incomplete documents", async () => {
    await expect(
      fetchFeedXml("https://mock.example/feed", {
        ...feedOpts(fakeInternet({ "https://mock.example/feed": { status: 204, body: Buffer.alloc(0), headers: {} } })),
      }),
    ).rejects.toMatchObject({ code: "UPSTREAM_ERROR", message: "The feed server answered with HTTP 204." });

    await expect(
      fetchFeedXml("https://mock.example/feed", {
        ...feedOpts(fakeInternet({ "https://mock.example/feed": { status: 206, body: Buffer.from(RSS), headers: {} } })),
      }),
    ).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
  });

  it("rejects a redirect with an unparseable Location", async () => {
    await expect(
      fetchFeedXml("https://mock.example/feed", {
        ...feedOpts(
          fakeInternet({
            "https://mock.example/feed": { status: 302, headers: { location: "http://[:::" }, body: Buffer.alloc(0) },
          }),
        ),
      }),
    ).rejects.toMatchObject({ code: "UPSTREAM_ERROR", message: "The feed server sent a broken redirect." });
  });
});

describe("fetchTextSafely – article wording", () => {
  it("uses article labels on size and connection failures", async () => {
    await expect(
      fetchTextSafely(
        "https://mock.example/a",
        {
          accept: "text/html",
          label: "article",
          maxBytesLabel: "3 MB",
          checkContentType: assertArticleContentType,
        },
        feedOpts(
          fakeInternet({
            "https://mock.example/a": async () => {
              throw new FeedRouteError("RESPONSE_TOO_LARGE", 413, "The feed is too large (limit is 2 MB).");
            },
          }),
        ),
      ),
    ).rejects.toMatchObject({ message: "The article is too large (limit is 3 MB)." });
  });
});

describe("assertFeedContentType", () => {
  it("accepts XML types and generic types whose body looks like XML", () => {
    expect(() => assertFeedContentType("application/rss+xml", RSS)).not.toThrow();
    expect(() => assertFeedContentType("application/atom+xml; charset=utf-8", RSS)).not.toThrow();
    expect(() => assertFeedContentType("text/xml", RSS)).not.toThrow();
    expect(() => assertFeedContentType("application/rdf+xml", RSS)).not.toThrow();
    expect(() => assertFeedContentType("text/plain", RSS)).not.toThrow();
    expect(() => assertFeedContentType("", RSS)).not.toThrow();
    expect(() => assertFeedContentType("application/octet-stream", `  ${RSS}`)).not.toThrow();
  });

  it("rejects HTML, JSON, SVG, XHTML and empty generic bodies", () => {
    expect(() => assertFeedContentType("text/html", HTML)).toThrow(FeedRouteError);
    try {
      assertFeedContentType("text/html", HTML);
    } catch (error) {
      expect(error).toMatchObject({
        code: "UNSUPPORTED_CONTENT_TYPE",
        status: 415,
      });
      expect((error as Error).message).toContain("paste the address of its RSS or Atom feed");
    }
    expect(() => assertFeedContentType("application/json", "{}")).toThrow(/application\/json/);
    expect(() => assertFeedContentType("image/svg+xml", "<svg/>")).toThrow(FeedRouteError);
    expect(() => assertFeedContentType("application/xhtml+xml", HTML)).toThrow(FeedRouteError);
    expect(() => assertFeedContentType("text/plain", "hello")).toThrow(FeedRouteError);
    expect(() => assertFeedContentType("!!!", RSS)).toThrow(/unknown type/);
  });
});

describe("assertArticleContentType", () => {
  it("accepts HTML and XHTML, and a generic type when the body is HTML", () => {
    expect(() => assertArticleContentType("text/html; charset=utf-8", HTML)).not.toThrow();
    expect(() => assertArticleContentType("application/xhtml+xml", HTML)).not.toThrow();
    expect(() => assertArticleContentType("text/plain", HTML)).not.toThrow();
    expect(() => assertArticleContentType("", "\uFEFF<!DOCTYPE html><html></html>")).not.toThrow();
  });

  it("rejects feeds, PDFs, JSON and empty generic bodies", () => {
    expect(() => assertArticleContentType("application/rss+xml", RSS)).toThrow(/not a web page/);
    expect(() => assertArticleContentType("application/pdf", "%PDF")).toThrow(FeedRouteError);
    expect(() => assertArticleContentType("application/json", "{}")).toThrow(/application\/json/);
    expect(() => assertArticleContentType("", RSS)).toThrow(FeedRouteError);
    expect(() => assertArticleContentType("not a mime", HTML)).toThrow(/unknown type/);
  });
});

describe("decodeBody", () => {
  it("uses the Content-Type charset", () => {
    const bytes = Buffer.from("café", "latin1");
    expect(decodeBody(bytes, "text/xml; charset=iso-8859-1")).toBe("café");
  });

  it("uses a UTF-8 BOM when the header has no charset", () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hi")]);
    expect(decodeBody(bytes, "application/xml")).toBe("hi");
  });

  it("reads an XML encoding declaration", () => {
    const xml = `<?xml version="1.0" encoding="iso-8859-1"?><rss></rss>`;
    const bytes = Buffer.from(xml, "latin1");
    expect(decodeBody(bytes, "application/xml")).toContain("<rss");
  });

  it("falls back to UTF-8 for an unknown charset label", () => {
    expect(decodeBody(Buffer.from("ok"), "text/xml; charset=not-a-real-encoding")).toBe("ok");
  });

  it("decodes empty bodies", () => {
    expect(decodeBody(Buffer.alloc(0), "")).toBe("");
  });
});
