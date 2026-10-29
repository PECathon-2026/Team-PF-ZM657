// Tests for lib/api-request.ts (shared browser caller of our API).
import { describe, expect, it, vi } from "vitest";
import { apiFailure, DEFAULT_TIMEOUT_MS, getApiJson } from "@/lib/api-request";
import { articlePageApiResponseSchema, feedApiResponseSchema } from "@/lib/validation";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const okFeed = {
  success: true as const,
  feed: { title: "T", feedUrl: "https://mock.example/feed" },
  items: [] as [],
};

describe("apiFailure", () => {
  it("marks temporary codes as retryable and permanent ones as not", () => {
    expect(apiFailure("TIMEOUT", "slow")).toMatchObject({ ok: false, retryable: true });
    expect(apiFailure("RATE_LIMITED", "wait")).toMatchObject({ retryable: true });
    expect(apiFailure("NETWORK_ERROR", "offline")).toMatchObject({ retryable: true });
    expect(apiFailure("INVALID_URL", "bad")).toMatchObject({ retryable: false });
    expect(apiFailure("BLOCKED_HOST", "local")).toMatchObject({ retryable: false });
    expect(apiFailure("NOT_FOUND", "missing")).toMatchObject({ retryable: false });
    expect(apiFailure("CANCELLED", "stop")).toMatchObject({ retryable: false });
  });
});

describe("getApiJson", () => {
  it("returns parsed success JSON from our route", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (path) => {
      expect(path).toBe("/api/feed?url=https%3A%2F%2Fmock.example%2Ffeed");
      return json(okFeed);
    });
    const result = await getApiJson("/api/feed?url=https%3A%2F%2Fmock.example%2Ffeed", feedApiResponseSchema, { fetchImpl });
    expect(result).toEqual({ ok: true, data: okFeed });
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: "GET", headers: { Accept: "application/json" } });
  });

  it("passes through a structured API error", async () => {
    const fetchImpl = vi.fn(async () => json({ success: false, error: { code: "INVALID_XML", message: "Not a feed." } }, 422));
    const result = await getApiJson("/api/feed", feedApiResponseSchema, { fetchImpl });
    expect(result).toEqual({ ok: false, code: "INVALID_XML", message: "Not a feed.", retryable: false });
  });

  it("treats non-JSON and wrong-shaped JSON as BAD_RESPONSE", async () => {
    const html = vi.fn(async () => new Response("<html>oops</html>", { status: 502 }));
    expect(await getApiJson("/api/feed", feedApiResponseSchema, { fetchImpl: html })).toMatchObject({
      ok: false,
      code: "BAD_RESPONSE",
      retryable: true,
    });

    const wrong = vi.fn(async () => json({ success: true, feed: { title: 1 } }));
    expect(await getApiJson("/api/feed", feedApiResponseSchema, { fetchImpl: wrong })).toMatchObject({
      code: "BAD_RESPONSE",
      message: "The server sent an unexpected response. Please try again.",
    });
  });

  it("handles a network failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await getApiJson("/api/feed", feedApiResponseSchema, { fetchImpl })).toEqual({
      ok: false,
      code: "NETWORK_ERROR",
      message: "Could not reach the NOVA Reader server. Check your connection and try again.",
      retryable: true,
    });
  });

  it("times out and never throws", async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
        ),
    );
    const result = await getApiJson("/api/feed", feedApiResponseSchema, { fetchImpl, timeoutMs: 30 });
    expect(result).toMatchObject({ ok: false, code: "CLIENT_TIMEOUT", retryable: true });
  });

  it("returns CANCELLED when the caller aborts first", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    const result = await getApiJson("/api/feed", feedApiResponseSchema, { fetchImpl, signal: controller.signal });
    expect(result).toMatchObject({ ok: false, code: "CANCELLED", retryable: false });
  });

  it("works with the article schema", async () => {
    const body = { success: true as const, page: { url: "https://b.example/a", html: "<p>x</p>" } };
    const fetchImpl = vi.fn(async () => json(body));
    const result = await getApiJson("/api/article?url=x", articlePageApiResponseSchema, { fetchImpl });
    expect(result).toEqual({ ok: true, data: body });
  });

  it("uses the default 20 second timeout constant", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(20_000);
  });
});
