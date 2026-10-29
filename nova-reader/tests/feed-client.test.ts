// Tests for lib/feed-client.ts (browser-side API caller).
// `fetch` is replaced with a fake, so no server or network is needed.
import { describe, expect, it, vi } from "vitest";
import { buildFeedApiUrl, loadFeed } from "@/lib/feed-client";

const SUCCESS = {
  success: true,
  feed: { title: "Mock Blog", description: "Notes", siteUrl: "https://mock.example/", feedUrl: "https://mock.example/feed" },
  items: [{ id: "a-1", title: "Hello", url: "https://mock.example/hello", summary: "Hi there" }],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("buildFeedApiUrl", () => {
  it("encodes the feed URL as one query parameter", () => {
    expect(buildFeedApiUrl("https://mock.example/feed?a=1&b=2#x")).toBe(
      "/api/feed?url=https%3A%2F%2Fmock.example%2Ffeed%3Fa%3D1%26b%3D2%23x",
    );
  });
});

describe("loadFeed", () => {
  it("calls the Stage 3 route (not the feed URL) and returns the feed", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(SUCCESS));
    const result = await loadFeed("  https://mock.example/feed  ", { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/feed?url=https%3A%2F%2Fmock.example%2Ffeed");
    expect(result).toEqual({ ok: true, feed: SUCCESS.feed, items: SUCCESS.items });
  });

  it("validates the URL before calling the server", async () => {
    const fetchImpl = vi.fn();
    expect(await loadFeed("not a url", { fetchImpl })).toMatchObject({ ok: false, code: "INVALID_URL", retryable: false });
    expect(await loadFeed("ftp://x.example", { fetchImpl })).toMatchObject({ ok: false, code: "UNSUPPORTED_PROTOCOL" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("passes server errors through with their message", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: false, error: { code: "UPSTREAM_ERROR", message: "The feed server answered with HTTP 404." } }, 502),
    );
    expect(await loadFeed("https://mock.example/feed", { fetchImpl })).toEqual({
      ok: false,
      code: "UPSTREAM_ERROR",
      message: "The feed server answered with HTTP 404.",
      retryable: true,
    });
  });

  it("marks permanent errors as not retryable", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: false, error: { code: "UNSUPPORTED_CONTENT_TYPE", message: "Not a feed." } }, 415),
    );
    expect(await loadFeed("https://mock.example/page", { fetchImpl })).toMatchObject({ retryable: false });
  });

  it("handles a non-JSON reply (e.g. an HTML error page)", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502 }));
    expect(await loadFeed("https://mock.example/feed", { fetchImpl })).toMatchObject({
      ok: false,
      code: "BAD_RESPONSE",
      retryable: true,
    });
  });

  it("handles JSON with the wrong shape", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, feed: null }));
    expect(await loadFeed("https://mock.example/feed", { fetchImpl })).toMatchObject({ ok: false, code: "BAD_RESPONSE" });
  });

  it("handles network failures", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await loadFeed("https://mock.example/feed", { fetchImpl })).toMatchObject({
      ok: false,
      code: "NETWORK_ERROR",
      retryable: true,
    });
  });

  it("gives up after its own timeout", async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    expect(await loadFeed("https://slow.example/feed", { fetchImpl, timeoutMs: 30 })).toMatchObject({
      ok: false,
      code: "CLIENT_TIMEOUT",
      retryable: true,
    });
  });

  it("can be cancelled by the caller", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    const pending = loadFeed("https://mock.example/feed", { fetchImpl, signal: controller.signal });
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, code: "CANCELLED" });
  });
});
