// Tests for GET /api/article (lib/server/article-handler.ts + app/api/article/route.ts).
// Same SSRF protection as /api/feed; returns raw HTML inside JSON; no extraction on the server.
import { describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/article/route";
import { handleArticleRequest, MAX_ARTICLE_BYTES, type ArticleHandlerDeps } from "@/lib/server/article-handler";
import { FeedRouteError } from "@/lib/server/errors";
import type { HttpResponse } from "@/lib/server/http-client";
import { InMemoryRateLimiter } from "@/lib/server/rate-limit";
import { articlePageApiResponseSchema } from "@/lib/validation";
import { ARTICLE_PAGE_HTML, ARTICLE_PAGE_URL } from "./helpers/article-fixture";
import { fakeInternet } from "./helpers/fake-internet";

const allowAll = { check: () => ({ allowed: true as const }) };

async function callApi(url: string | undefined, net: ReturnType<typeof fakeInternet>, extra: ArticleHandlerDeps = {}) {
  const query = url === undefined ? "" : `?url=${encodeURIComponent(url)}`;
  const response = await handleArticleRequest(new Request(`http://localhost/api/article${query}`), {
    rateLimiter: allowAll,
    fetchOptions: { resolver: net.resolver, transport: net.transport, timeoutMs: 1000 },
    ...extra,
  });
  const text = await response.text();
  return { response, text, json: JSON.parse(text) };
}

const page = (body = ARTICLE_PAGE_HTML, headers: Record<string, string> = {}): Partial<HttpResponse> => ({
  body: Buffer.from(body),
  headers: { "content-type": "text/html; charset=utf-8", ...headers },
});

describe("GET /api/article – success", () => {
  it("returns the raw page HTML inside JSON, with the final URL", async () => {
    const net = fakeInternet({ [ARTICLE_PAGE_URL]: page() });
    const { response, json } = await callApi(ARTICLE_PAGE_URL, net);

    expect(response.status).toBe(200);
    expect(json).toEqual({ success: true, page: { url: ARTICLE_PAGE_URL, html: ARTICLE_PAGE_HTML } });
    expect(articlePageApiResponseSchema.safeParse(json).success).toBe(true);
  });

  it("never serves the page as HTML from our domain (JSON + CSP + nosniff)", async () => {
    const net = fakeInternet({ [ARTICLE_PAGE_URL]: page() });
    const { response } = await callApi(ARTICLE_PAGE_URL, net);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("does not extract or change the HTML on the server", async () => {
    const net = fakeInternet({ [ARTICLE_PAGE_URL]: page() });
    const { json } = await callApi(ARTICLE_PAGE_URL, net);
    expect(json.page.html).toContain("<script>window.__pageScriptRan = true;</script>"); // untouched raw data
  });

  it("follows a safe redirect and reports the final URL", async () => {
    const net = fakeInternet({
      "http://blog.example/p/1": { status: 301, headers: { location: ARTICLE_PAGE_URL } },
      [ARTICLE_PAGE_URL]: page(),
    });
    expect((await callApi("http://blog.example/p/1", net)).json.page.url).toBe(ARTICLE_PAGE_URL);
  });

  it("uses a 3 MB limit for article pages", async () => {
    const net = fakeInternet({ [ARTICLE_PAGE_URL]: page() });
    await callApi(ARTICLE_PAGE_URL, net);
    expect(net.seenOptions[0].maxBytes).toBe(MAX_ARTICLE_BYTES);
    expect(MAX_ARTICLE_BYTES).toBe(3 * 1024 * 1024);
  });

  it("accepts XHTML, and a generic type when the body is clearly HTML", async () => {
    const xhtml = fakeInternet({ [ARTICLE_PAGE_URL]: page(ARTICLE_PAGE_HTML, { "content-type": "application/xhtml+xml" }) });
    expect((await callApi(ARTICLE_PAGE_URL, xhtml)).json.success).toBe(true);
    const plain = fakeInternet({ [ARTICLE_PAGE_URL]: page(ARTICLE_PAGE_HTML, { "content-type": "text/plain" }) });
    expect((await callApi(ARTICLE_PAGE_URL, plain)).json.success).toBe(true);
  });

  it("works through the real route file", async () => {
    const response = await GET(new Request("http://localhost/api/article"));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_URL");
  });
});

describe("GET /api/article – SSRF and input validation", () => {
  it.each([
    ["missing URL", undefined, "INVALID_URL"],
    ["malformed URL", "not a url", "INVALID_URL"],
    ["javascript:", "javascript:alert(1)", "UNSUPPORTED_PROTOCOL"],
    ["file:", "file:///etc/passwd", "UNSUPPORTED_PROTOCOL"],
    ["credentials", "https://u:p@blog.example/a", "INVALID_URL"],
    ["localhost", "http://localhost/admin", "BLOCKED_HOST"],
    ["loopback", "http://127.0.0.1/", "BLOCKED_HOST"],
    ["private IP", "http://10.0.0.8/", "BLOCKED_HOST"],
    ["cloud metadata", "http://169.254.169.254/latest/meta-data/", "BLOCKED_HOST"],
    ["unsafe IPv6", "http://[fd00::1]/", "BLOCKED_HOST"],
    ["non-web port", "http://blog.example:22/", "BLOCKED_HOST"],
  ])("rejects %s without any request", async (_label, url, code) => {
    const net = fakeInternet({});
    const { response, json } = await callApi(url, net);
    expect(response.status).toBe(400);
    expect(json.error.code).toBe(code);
    expect(net.requested).toEqual([]);
  });

  it("blocks a hostname that resolves to a private address", async () => {
    const net = fakeInternet({ "https://intranet.example/": page() }, { "intranet.example": [{ address: "192.168.1.5", family: 4 }] });
    const { json, text } = await callApi("https://intranet.example/", net);
    expect(json.error.code).toBe("BLOCKED_HOST");
    expect(text).not.toContain("192.168.1.5");
    expect(net.requested).toEqual([]);
  });

  it("blocks an unsafe redirect", async () => {
    const net = fakeInternet({ [ARTICLE_PAGE_URL]: { status: 302, headers: { location: "http://169.254.169.254/" } } });
    expect((await callApi(ARTICLE_PAGE_URL, net)).json.error.code).toBe("BLOCKED_HOST");
  });

  it("limits redirects", async () => {
    const net = fakeInternet({
      "https://r.example/0": { status: 301, headers: { location: "/1" } },
      "https://r.example/1": { status: 301, headers: { location: "/2" } },
      "https://r.example/2": { status: 301, headers: { location: "/3" } },
      "https://r.example/3": { status: 301, headers: { location: "/4" } },
    });
    const { json } = await callApi("https://r.example/0", net);
    expect(json.error).toEqual({ code: "TOO_MANY_REDIRECTS", message: "The article redirected too many times." });
  });
});

describe("GET /api/article – upstream and content problems", () => {
  it.each([["application/pdf"], ["image/png"], ["application/json"], ["application/rss+xml"]])(
    "rejects non-HTML content type %s",
    async (type) => {
      const net = fakeInternet({ [ARTICLE_PAGE_URL]: page("%PDF-1.7", { "content-type": type }) });
      const { response, json } = await callApi(ARTICLE_PAGE_URL, net);
      expect(response.status).toBe(415);
      expect(json.error.code).toBe("UNSUPPORTED_CONTENT_TYPE");
      expect(json.error.message).toContain("not a web page");
    },
  );

  it("reports upstream HTTP errors", async () => {
    const net = fakeInternet({ [ARTICLE_PAGE_URL]: { status: 403, body: Buffer.from("Forbidden") } });
    const { response, json } = await callApi(ARTICLE_PAGE_URL, net);
    expect(response.status).toBe(502);
    expect(json.error).toEqual({ code: "UPSTREAM_ERROR", message: "The article server answered with HTTP 403." });
  });

  it("reports timeouts", async () => {
    const net = fakeInternet({
      [ARTICLE_PAGE_URL]: (_url, options) =>
        new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason))),
    });
    const { response, json } = await callApi(ARTICLE_PAGE_URL, net, {
      fetchOptions: { resolver: net.resolver, transport: net.transport, timeoutMs: 50 },
    });
    expect(response.status).toBe(504);
    expect(json.error).toEqual({ code: "TIMEOUT", message: "The article took too long to respond." });
  });

  it("reports oversized pages with the article limit", async () => {
    const net = fakeInternet({
      [ARTICLE_PAGE_URL]: async () => {
        throw new FeedRouteError("RESPONSE_TOO_LARGE", 413, "The feed is too large (limit is 2 MB).");
      },
    });
    const { response, json } = await callApi(ARTICLE_PAGE_URL, net);
    expect(response.status).toBe(413);
    expect(json.error).toEqual({ code: "RESPONSE_TOO_LARGE", message: "The article is too large (limit is 3 MB)." });
  });

  it("reports connection failures without internal details", async () => {
    const net = fakeInternet({
      [ARTICLE_PAGE_URL]: async () => {
        throw Object.assign(new Error("connect ECONNREFUSED 10.9.9.9:443"), { code: "ECONNREFUSED" });
      },
    });
    const { json, text } = await callApi(ARTICLE_PAGE_URL, net);
    expect(json.error).toEqual({ code: "FETCH_FAILED", message: "Could not connect to the article's website." });
    expect(text).not.toContain("10.9.9.9");
  });

  it("never leaks stack traces", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const net = fakeInternet({ [ARTICLE_PAGE_URL]: page() });
    const broken = {
      check: () => {
        throw new Error("SECRET at /srv/app/handler.ts:9");
      },
    };
    const { response, text } = await callApi(ARTICLE_PAGE_URL, net, { rateLimiter: broken });
    expect(response.status).toBe(500);
    expect(text).not.toMatch(/SECRET|handler\.ts|\bat\s/);
    errorSpy.mockRestore();
  });

  it("has its own rate limit (429 with Retry-After)", async () => {
    const net = fakeInternet({ [ARTICLE_PAGE_URL]: page() });
    const limiter = new InMemoryRateLimiter(1, 60_000);
    await callApi(ARTICLE_PAGE_URL, net, { rateLimiter: limiter });
    const second = await callApi(ARTICLE_PAGE_URL, net, { rateLimiter: limiter });
    expect(second.response.status).toBe(429);
    expect(second.response.headers.get("retry-after")).toBeTruthy();
  });
});
