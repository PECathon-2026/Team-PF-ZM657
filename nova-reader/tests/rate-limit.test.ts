// Tests for lib/server/rate-limit.ts (InMemoryRateLimiter + getClientKey).
import { describe, expect, it } from "vitest";
import { getClientKey, InMemoryRateLimiter } from "@/lib/server/rate-limit";

describe("InMemoryRateLimiter", () => {
  it("allows up to the limit, then reports retryAfterSeconds", () => {
    const now = 1_000;
    const limiter = new InMemoryRateLimiter(2, 10_000, 100, () => now);
    expect(limiter.check("client")).toEqual({ allowed: true });
    expect(limiter.check("client")).toEqual({ allowed: true });
    expect(limiter.check("client")).toEqual({ allowed: false, retryAfterSeconds: 10 });
  });

  it("treats an empty key as a real client (not a bypass)", () => {
    const limiter = new InMemoryRateLimiter(1, 60_000, 100, () => 0);
    expect(limiter.check("")).toEqual({ allowed: true });
    expect(limiter.check("")).toMatchObject({ allowed: false });
  });

  it("frees expired keys so new clients can be tracked", () => {
    let now = 0;
    const limiter = new InMemoryRateLimiter(5, 1_000, 2, () => now);
    expect(limiter.check("a")).toEqual({ allowed: true });
    expect(limiter.check("b")).toEqual({ allowed: true });
    now = 1_001;
    expect(limiter.check("c")).toEqual({ allowed: true });
  });

  it("refuses rather than growing when unexpired keys fill the cap", () => {
    const limiter = new InMemoryRateLimiter(1, 60_000, 2, () => 50);
    limiter.check("a");
    limiter.check("b");
    expect(limiter.check("c")).toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect(limiter.check("a")).toEqual({ allowed: false, retryAfterSeconds: 60 });
  });
});

describe("getClientKey", () => {
  it("hashes the client IP instead of storing it", () => {
    const key = getClientKey(new Request("http://localhost/api/feed", { headers: { "x-forwarded-for": "203.0.113.10" } }));
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain("203.0.113.10");
  });

  it("uses the first x-forwarded-for hop and ignores later ones", () => {
    const first = getClientKey(
      new Request("http://localhost/api/feed", { headers: { "x-forwarded-for": "203.0.113.10, 198.51.100.1" } }),
    );
    const onlyFirst = getClientKey(new Request("http://localhost/api/feed", { headers: { "x-forwarded-for": "203.0.113.10" } }));
    const second = getClientKey(new Request("http://localhost/api/feed", { headers: { "x-forwarded-for": "198.51.100.1" } }));
    expect(first).toBe(onlyFirst);
    expect(first).not.toBe(second);
  });

  it("falls back to x-real-ip, then unknown", () => {
    const fromRealIp = getClientKey(new Request("http://localhost/api/feed", { headers: { "x-real-ip": "198.51.100.9" } }));
    const unknown = getClientKey(new Request("http://localhost/api/feed"));
    const emptyForwarded = getClientKey(
      new Request("http://localhost/api/feed", { headers: { "x-forwarded-for": "   ", "x-real-ip": "198.51.100.9" } }),
    );
    expect(fromRealIp).toBe(emptyForwarded);
    expect(unknown).not.toBe(fromRealIp);
    expect(unknown).toMatch(/^[0-9a-f]{32}$/);
  });

  it("trims the forwarded address", () => {
    const trimmed = getClientKey(new Request("http://localhost/api/feed", { headers: { "x-forwarded-for": "  203.0.113.10  " } }));
    const plain = getClientKey(new Request("http://localhost/api/feed", { headers: { "x-forwarded-for": "203.0.113.10" } }));
    expect(trimmed).toBe(plain);
  });
});
