// Tests for app/api/feed/route.ts. The real internet is never used:
// `fetch` is replaced with a fake (vi.stubGlobal) for each test.
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/feed/route";

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Mock Blog</title>
<link>https://mock.example.com/</link><item><title>Hi</title><link>https://mock.example.com/hi</link></item>
</channel></rss>`;

function callRoute(feedUrl?: string) {
  const query = feedUrl === undefined ? "" : `?url=${encodeURIComponent(feedUrl)}`;
  return GET(new Request(`http://localhost/api/feed${query}`));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/feed", () => {
  it("returns normalized JSON for a valid feed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(RSS, { status: 200 })));

    const res = await callRoute("https://mock.example.com/feed");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.feed).toEqual({ title: "Mock Blog", siteUrl: "https://mock.example.com/", feedUrl: "https://mock.example.com/feed" });
    expect(json.items).toHaveLength(1);
  });

  it("rejects a missing url with INVALID_URL", async () => {
    const res = await callRoute();
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_URL");
  });

  it("rejects localhost without making a request", async () => {
    const fakeFetch = vi.fn();
    vi.stubGlobal("fetch", fakeFetch);
    const res = await callRoute("http://localhost:3000/secret");
    expect((await res.json()).error.code).toBe("BLOCKED_HOST");
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("blocks redirects to private addresses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } })),
    );
    const json = await (await callRoute("https://mock.example.com/feed")).json();
    expect(json.error.code).toBe("BLOCKED_HOST");
  });

  it("reports upstream HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not found", { status: 404 })));
    const res = await callRoute("https://mock.example.com/missing");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toEqual({ code: "UPSTREAM_ERROR", message: "The feed server answered with HTTP 404." });
  });

  it("reports invalid XML", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<rss><channel>", { status: 200 })));
    const res = await callRoute("https://mock.example.com/feed");
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("INVALID_XML");
  });

  it("rejects responses larger than 2 MB", async () => {
    const huge = "x".repeat(2 * 1024 * 1024 + 10);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(huge, { status: 200 })));
    const res = await callRoute("https://mock.example.com/feed");
    expect((await res.json()).error.code).toBe("RESPONSE_TOO_LARGE");
  });

  it("reports timeouts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }),
    );
    const res = await callRoute("https://slow.example.com/feed");
    expect(res.status).toBe(504);
    expect((await res.json()).error.code).toBe("TIMEOUT");
  });

  it("reports network failures without leaking details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("getaddrinfo ENOTFOUND secret-internal-detail");
      }),
    );
    const json = await (await callRoute("https://dead.example.com/feed")).json();
    expect(json.error.code).toBe("FETCH_FAILED");
    expect(JSON.stringify(json)).not.toContain("secret-internal-detail");
  });
});
