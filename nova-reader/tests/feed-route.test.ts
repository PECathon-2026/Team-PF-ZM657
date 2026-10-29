// Tests for GET /api/feed (lib/server/feed-handler.ts + app/api/feed/route.ts).
//
// No real DNS or internet: a fake resolver and a fake transport replace them.
// The fake transport calls the real pinned `lookup` before "connecting",
// exactly like Node's HTTP client, so SSRF checks run for real.
import { isIP } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/feed/route";
import { handleFeedRequest, type FeedHandlerDeps } from "@/lib/server/feed-handler";
import type { HttpResponse, Transport } from "@/lib/server/http-client";
import { InMemoryRateLimiter } from "@/lib/server/rate-limit";
import type { HostResolver, ResolvedAddress } from "@/lib/server/ssrf";
import { feedApiResponseSchema } from "@/lib/validation";

const PUBLIC_IP = "93.184.215.14";

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Mock Blog</title>
<link>https://mock.example/</link><description>A test feed</description>
<item><title>Hi</title><link>/hi</link><guid>post-1</guid><pubDate>Thu, 29 Oct 2026 10:00:00 GMT</pubDate></item>
</channel></rss>`;

type FakeReply = Partial<HttpResponse> | ((url: URL, signal: AbortSignal) => Promise<Partial<HttpResponse>>);

/** Builds fake DNS + network. `replies` maps full URLs to responses. */
function fakeInternet(replies: Record<string, FakeReply>, dns: Record<string, ResolvedAddress[]> = {}) {
  const requested: string[] = [];
  const resolver: HostResolver = async (host) => dns[host] ?? [{ address: PUBLIC_IP, family: 4 }];

  const transport: Transport = async (url, options) => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) === 0) {
      // Same as Node: resolve through the pinned lookup before connecting.
      await new Promise<void>((resolve, reject) =>
        options.lookup(host, { all: true }, (error) => (error ? reject(error) : resolve())),
      );
    }
    requested.push(url.toString());
    const reply = replies[url.toString()];
    if (!reply) return { status: 404, headers: {}, body: Buffer.alloc(0) };
    const partial = typeof reply === "function" ? await reply(url, options.signal) : reply;
    return { status: 200, headers: { "content-type": "application/rss+xml; charset=utf-8" }, body: Buffer.alloc(0), ...partial };
  };
  return { resolver, transport, requested };
}

const allowAll = { check: () => ({ allowed: true as const }) };

async function callApi(feedUrl: string | undefined, internet: ReturnType<typeof fakeInternet>, extra: FeedHandlerDeps = {}) {
  const query = feedUrl === undefined ? "" : `?url=${encodeURIComponent(feedUrl)}`;
  const response = await handleFeedRequest(new Request(`http://localhost/api/feed${query}`), {
    rateLimiter: allowAll,
    fetchOptions: { resolver: internet.resolver, transport: internet.transport, timeoutMs: 1000 },
    ...extra,
  });
  const text = await response.text();
  return { response, text, json: JSON.parse(text) };
}

const okFeed = (body = RSS, headers: Record<string, string> = {}): Partial<HttpResponse> => ({
  body: Buffer.from(body),
  headers: { "content-type": "application/rss+xml; charset=utf-8", ...headers },
});

describe("GET /api/feed – success", () => {
  it("returns the normalized feed for a valid request", async () => {
    const net = fakeInternet({ "https://mock.example/feed.xml": okFeed() });
    const { response, json } = await callApi("https://mock.example/feed.xml", net);

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      success: true,
      feed: { title: "Mock Blog", description: "A test feed", siteUrl: "https://mock.example/", feedUrl: "https://mock.example/feed.xml" },
    });
    expect(json.items[0]).toMatchObject({ title: "Hi", url: "https://mock.example/hi", publishedAt: "2026-10-29T10:00:00.000Z" });
  });

  it("matches the API success schema exactly", async () => {
    const net = fakeInternet({ "https://mock.example/feed.xml": okFeed() });
    const { json } = await callApi("https://mock.example/feed.xml", net);
    const parsed = feedApiResponseSchema.safeParse(json);
    expect(parsed.success).toBe(true);
    expect(Object.keys(json).sort()).toEqual(["feed", "items", "success"]);
  });

  it("sends safe response headers", async () => {
    const net = fakeInternet({ "https://mock.example/feed.xml": okFeed() });
    const { response } = await callApi("https://mock.example/feed.xml", net);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("follows a safe redirect and resolves links against the final URL", async () => {
    const net = fakeInternet({
      "http://mock.example/rss": { status: 301, headers: { location: "https://cdn.example/blog/feed.xml" } },
      "https://cdn.example/blog/feed.xml": okFeed(RSS.replace("<link>https://mock.example/</link>", "")),
    });
    const { json } = await callApi("http://mock.example/rss", net);
    expect(json.feed.feedUrl).toBe("https://cdn.example/blog/feed.xml");
    expect(json.items[0].url).toBe("https://cdn.example/hi");
  });

  it("works through the real route file (app/api/feed/route.ts)", async () => {
    const response = await GET(new Request("http://localhost/api/feed"));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_URL");
  });
});

describe("GET /api/feed – input validation (no network request is made)", () => {
  it.each([
    ["missing URL", undefined, "INVALID_URL"],
    ["empty URL", "   ", "INVALID_URL"],
    ["invalid URL", "not a url", "INVALID_URL"],
    ["unsupported protocol (ftp)", "ftp://mock.example/feed", "UNSUPPORTED_PROTOCOL"],
    ["unsupported protocol (javascript)", "javascript:alert(1)", "UNSUPPORTED_PROTOCOL"],
    ["credentials", "https://user:pass@mock.example/feed", "INVALID_URL"],
    ["localhost", "http://localhost:3000/feed", "BLOCKED_HOST"],
    ["loopback address", "http://127.0.0.1/feed", "BLOCKED_HOST"],
    ["loopback as a number", "http://2130706433/feed", "BLOCKED_HOST"],
    ["private IP", "http://192.168.1.10/feed", "BLOCKED_HOST"],
    ["cloud metadata", "http://169.254.169.254/latest/meta-data/", "BLOCKED_HOST"],
    ["unsafe IPv6 loopback", "http://[::1]/feed", "BLOCKED_HOST"],
    ["unsafe IPv6 unique-local", "http://[fd00::1]/feed", "BLOCKED_HOST"],
    ["unsafe IPv6 documentation range", "http://[2001:db8::1]/feed", "BLOCKED_HOST"],
    ["unsafe IPv6 mapped IPv4", "http://[::ffff:7f00:1]/feed", "BLOCKED_HOST"],
    ["multicast", "http://224.0.0.1/feed", "BLOCKED_HOST"],
    ["non-web port", "http://mock.example:6379/", "BLOCKED_HOST"],
  ])("rejects %s", async (_label, url, code) => {
    const net = fakeInternet({});
    const { response, json } = await callApi(url, net);
    expect(response.status).toBe(400);
    expect(json).toEqual({ success: false, error: { code, message: expect.any(String) } });
    expect(net.requested).toEqual([]);
  });
});

describe("GET /api/feed – DNS-based SSRF", () => {
  it.each([
    ["a private IPv4", [{ address: "10.0.0.7", family: 4 as const }]],
    ["loopback", [{ address: "127.0.0.1", family: 4 as const }]],
    ["metadata", [{ address: "169.254.169.254", family: 4 as const }]],
    ["an unsafe IPv6 (link-local AAAA)", [{ address: "fe80::1", family: 6 as const }]],
    ["public A + private AAAA", [{ address: PUBLIC_IP, family: 4 as const }, { address: "fd00::5", family: 6 as const }]],
  ])("blocks a hostname that resolves to %s", async (_label, records) => {
    const net = fakeInternet({ "https://evil.example/feed": okFeed() }, { "evil.example": records });
    const { json, text } = await callApi("https://evil.example/feed", net);
    expect(json.error.code).toBe("BLOCKED_HOST");
    expect(net.requested).toEqual([]);
    // Internal details are not revealed.
    for (const record of records) expect(text).not.toContain(record.address);
  });

  it("blocks an unsafe redirect to a private IP", async () => {
    const net = fakeInternet({ "https://mock.example/feed": { status: 302, headers: { location: "http://127.0.0.1/admin" } } });
    const { json } = await callApi("https://mock.example/feed", net);
    expect(json.error.code).toBe("BLOCKED_HOST");
    expect(net.requested).toEqual(["https://mock.example/feed"]);
  });

  it("blocks an unsafe redirect to a hostname that resolves privately", async () => {
    const net = fakeInternet(
      { "https://mock.example/feed": { status: 307, headers: { location: "https://internal.example/secrets" } } },
      { "internal.example": [{ address: "192.168.0.2", family: 4 }] },
    );
    const { json } = await callApi("https://mock.example/feed", net);
    expect(json.error.code).toBe("BLOCKED_HOST");
    expect(net.requested).toEqual(["https://mock.example/feed"]);
  });

  it("blocks a redirect to an unsupported protocol", async () => {
    const net = fakeInternet({ "https://mock.example/feed": { status: 302, headers: { location: "file:///etc/passwd" } } });
    expect((await callApi("https://mock.example/feed", net)).json.error.code).toBe("UNSUPPORTED_PROTOCOL");
  });
});

describe("GET /api/feed – upstream problems", () => {
  it("reports failed upstream requests (HTTP error status)", async () => {
    const net = fakeInternet({ "https://mock.example/missing": { status: 404, body: Buffer.from("Not found") } });
    const { response, json } = await callApi("https://mock.example/missing", net);
    expect(response.status).toBe(502);
    expect(json.error).toEqual({ code: "UPSTREAM_ERROR", message: "The feed server answered with HTTP 404." });
  });

  it("reports failed upstream requests (connection failure)", async () => {
    const net = fakeInternet({
      "https://down.example/feed": async () => {
        throw Object.assign(new Error("connect ECONNREFUSED 10.1.2.3:443"), { code: "ECONNREFUSED" });
      },
    });
    const { response, json, text } = await callApi("https://down.example/feed", net);
    expect(response.status).toBe(502);
    expect(json.error.code).toBe("FETCH_FAILED");
    expect(text).not.toContain("10.1.2.3");
  });

  it("times out slow servers", async () => {
    const net = fakeInternet({
      "https://slow.example/feed": (_url, signal) =>
        new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    });
    const started = Date.now();
    const { response, json } = await callApi("https://slow.example/feed", net, {
      fetchOptions: { resolver: net.resolver, transport: net.transport, timeoutMs: 50 },
    });
    expect(response.status).toBe(504);
    expect(json.error.code).toBe("TIMEOUT");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("rejects oversized responses", async () => {
    const net = fakeInternet({
      "https://big.example/feed": async () => {
        // The real transport enforces this while streaming; the fake simulates that error.
        const { FeedRouteError } = await import("@/lib/server/errors");
        throw new FeedRouteError("RESPONSE_TOO_LARGE", 413, "The feed is too large (limit is 2 MB).");
      },
    });
    const { response, json } = await callApi("https://big.example/feed", net);
    expect(response.status).toBe(413);
    expect(json.error.code).toBe("RESPONSE_TOO_LARGE");
  });

  it("rejects too many redirects (limit 3)", async () => {
    const net = fakeInternet({
      "https://r.example/0": { status: 301, headers: { location: "/1" } },
      "https://r.example/1": { status: 302, headers: { location: "/2" } },
      "https://r.example/2": { status: 307, headers: { location: "/3" } },
      "https://r.example/3": { status: 308, headers: { location: "/4" } },
      "https://r.example/4": okFeed(),
    });
    const { json } = await callApi("https://r.example/0", net);
    expect(json.error.code).toBe("TOO_MANY_REDIRECTS");
    expect(net.requested).toHaveLength(4); // the 5th URL is never requested
  });

  it("allows exactly 3 redirects", async () => {
    const net = fakeInternet({
      "https://r.example/0": { status: 301, headers: { location: "/1" } },
      "https://r.example/1": { status: 302, headers: { location: "/2" } },
      "https://r.example/2": { status: 307, headers: { location: "/3" } },
      "https://r.example/3": okFeed(),
    });
    expect((await callApi("https://r.example/0", net)).json.success).toBe(true);
  });

  it("rejects a redirect without a Location header", async () => {
    const net = fakeInternet({ "https://mock.example/feed": { status: 302, headers: {} } });
    expect((await callApi("https://mock.example/feed", net)).json.error.code).toBe("UPSTREAM_ERROR");
  });
});

describe("GET /api/feed – content checks", () => {
  it.each([
    ["text/html", "<html><body>Blog</body></html>"],
    ["application/json", '{"items":[]}'],
    ["image/png", "\u0089PNG"],
    ["image/svg+xml", "<svg/>"],
  ])("rejects invalid content type %s", async (type, body) => {
    const net = fakeInternet({ "https://mock.example/feed": { body: Buffer.from(body), headers: { "content-type": type } } });
    const { response, json } = await callApi("https://mock.example/feed", net);
    expect(response.status).toBe(415);
    expect(json.error.code).toBe("UNSUPPORTED_CONTENT_TYPE");
  });

  it.each([["application/atom+xml"], ["application/xml"], ["text/xml; charset=utf-8"], ["application/rdf+xml"]])(
    "accepts XML content type %s",
    async (type) => {
      const net = fakeInternet({ "https://mock.example/feed": okFeed(RSS, { "content-type": type }) });
      expect((await callApi("https://mock.example/feed", net)).json.success).toBe(true);
    },
  );

  it("accepts text/plain or a missing type only when the body is XML", async () => {
    const plainXml = fakeInternet({ "https://mock.example/feed": okFeed(RSS, { "content-type": "text/plain" }) });
    expect((await callApi("https://mock.example/feed", plainXml)).json.success).toBe(true);

    const plainText = fakeInternet({ "https://mock.example/feed": okFeed("hello", { "content-type": "text/plain" }) });
    expect((await callApi("https://mock.example/feed", plainText)).json.error.code).toBe("UNSUPPORTED_CONTENT_TYPE");
  });

  it("rejects malformed XML", async () => {
    const net = fakeInternet({ "https://mock.example/feed": okFeed("<rss><channel><title>Broken</channel>") });
    const { response, json } = await callApi("https://mock.example/feed", net);
    expect(response.status).toBe(422);
    expect(json.error.code).toBe("INVALID_XML");
  });

  it("reports parser errors for XML that is not RSS or Atom", async () => {
    const net = fakeInternet({ "https://mock.example/feed": okFeed(`<?xml version="1.0"?><note><to>you</to></note>`) });
    const { response, json } = await callApi("https://mock.example/feed", net);
    expect(response.status).toBe(422);
    expect(json.error.code).toBe("UNSUPPORTED_FORMAT");
  });

  it("decodes non-UTF-8 feeds using the declared charset", async () => {
    const latin1 = Buffer.from(`<?xml version="1.0" encoding="ISO-8859-1"?><rss><channel><title>Café</title></channel></rss>`, "latin1");
    const net = fakeInternet({ "https://mock.example/feed": { body: latin1, headers: { "content-type": "application/xml" } } });
    expect((await callApi("https://mock.example/feed", net)).json.feed.title).toBe("Café");
  });
});

describe("GET /api/feed – safe errors and rate limiting", () => {
  it("never leaks stack traces or internal error text", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const net = fakeInternet({ "https://mock.example/feed": okFeed() });
    const brokenLimiter = {
      check: () => {
        throw new Error("SECRET internal failure at /srv/app/db.ts:42 password=hunter2");
      },
    };
    const { response, text, json } = await callApi("https://mock.example/feed", net, { rateLimiter: brokenLimiter });

    expect(response.status).toBe(500);
    expect(json).toEqual({ success: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong while loading the feed." } });
    expect(text).not.toMatch(/SECRET|hunter2|db\.ts|\bat\s|stack/i);
    expect(errorSpy).toHaveBeenCalled(); // logged on the server only
    errorSpy.mockRestore();
  });

  it("returns 429 with Retry-After when the rate limit is exceeded", async () => {
    const net = fakeInternet({ "https://mock.example/feed": okFeed() });
    const limiter = new InMemoryRateLimiter(2, 60_000);
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await callApi("https://mock.example/feed", net, { rateLimiter: limiter }));
    expect(results.map((r) => r.response.status)).toEqual([200, 200, 429]);
    expect(results[2].json.error.code).toBe("RATE_LIMITED");
    expect(Number(results[2].response.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("InMemoryRateLimiter", () => {
  it("resets after the window and keeps clients separate", () => {
    let now = 0;
    const limiter = new InMemoryRateLimiter(1, 1000, 100, () => now);
    expect(limiter.check("a")).toEqual({ allowed: true });
    expect(limiter.check("a")).toMatchObject({ allowed: false });
    expect(limiter.check("b")).toEqual({ allowed: true });
    now = 1001;
    expect(limiter.check("a")).toEqual({ allowed: true });
  });

  it("does not grow memory without limit", () => {
    const limiter = new InMemoryRateLimiter(5, 60_000, 2, () => 0);
    limiter.check("a");
    limiter.check("b");
    expect(limiter.check("c")).toMatchObject({ allowed: false });
  });
});
