// Tests for lib/article-client.ts (browser-side caller of /api/article). Fake fetch only.
import { describe, expect, it, vi } from "vitest";
import { buildArticleApiUrl, fetchArticlePage } from "@/lib/article-client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("fetchArticlePage", () => {
  it("calls our /api/article route, not the article site", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ success: true, page: { url: "https://b.example/a", html: "<p>x</p>" } }));
    const result = await fetchArticlePage("https://b.example/a?x=1&y=2", { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe(buildArticleApiUrl("https://b.example/a?x=1&y=2"));
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/article?url=https%3A%2F%2Fb.example%2Fa%3Fx%3D1%26y%3D2");
    expect(result).toEqual({ ok: true, pageUrl: "https://b.example/a", html: "<p>x</p>" });
  });

  it("refuses unsafe article URLs before calling the server", async () => {
    const fetchImpl = vi.fn();
    expect(await fetchArticlePage("javascript:alert(1)", { fetchImpl })).toMatchObject({ ok: false, code: "UNSUPPORTED_PROTOCOL" });
    expect(await fetchArticlePage("http://localhost/x", { fetchImpl })).toMatchObject({ ok: false, code: "BLOCKED_HOST" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("passes server errors through, with retry hints", async () => {
    const permanent = vi.fn(async () => json({ success: false, error: { code: "UNSUPPORTED_CONTENT_TYPE", message: "Not a web page." } }, 415));
    expect(await fetchArticlePage("https://b.example/a.pdf", { fetchImpl: permanent })).toMatchObject({ ok: false, retryable: false });
    const temporary = vi.fn(async () => json({ success: false, error: { code: "TIMEOUT", message: "Slow." } }, 504));
    expect(await fetchArticlePage("https://b.example/a", { fetchImpl: temporary })).toMatchObject({ ok: false, code: "TIMEOUT", retryable: true });
  });

  it("rejects responses with the wrong shape", async () => {
    const fetchImpl = vi.fn(async () => json({ success: true, page: { html: 5 } }));
    expect(await fetchArticlePage("https://b.example/a", { fetchImpl })).toMatchObject({ ok: false, code: "BAD_RESPONSE" });
  });
});
