// Tests for lib/validation.ts. Run with: npm test
import { describe, expect, it } from "vitest";
import { feedApiResponseSchema, isBlockedHostname, validateFeedUrl } from "@/lib/validation";

describe("validateFeedUrl", () => {
  it("accepts normal http and https URLs", () => {
    expect(validateFeedUrl("https://jvns.ca/atom.xml")).toEqual({ ok: true, url: "https://jvns.ca/atom.xml" });
    expect(validateFeedUrl("http://example.com/rss")).toMatchObject({ ok: true });
  });

  it("trims spaces and removes #fragments", () => {
    expect(validateFeedUrl("  https://example.com/feed#top  ")).toEqual({ ok: true, url: "https://example.com/feed" });
  });

  it.each([[""], ["   "], [undefined], [null], [42]])("rejects empty or non-string input: %s", (input) => {
    expect(validateFeedUrl(input)).toMatchObject({ ok: false, code: "INVALID_URL" });
  });

  it("rejects malformed URLs", () => {
    expect(validateFeedUrl("not a url")).toMatchObject({ ok: false, code: "INVALID_URL" });
    expect(validateFeedUrl("example.com/feed")).toMatchObject({ ok: false, code: "INVALID_URL" });
  });

  it("rejects very long URLs", () => {
    expect(validateFeedUrl("https://example.com/" + "a".repeat(3000))).toMatchObject({ ok: false });
  });

  it.each([["ftp://example.com/feed"], ["file:///etc/passwd"], ["javascript:alert(1)"], ["data:text/xml,<rss/>"]])(
    "rejects non-http protocols: %s",
    (input) => {
      expect(validateFeedUrl(input)).toMatchObject({ ok: false, code: "UNSUPPORTED_PROTOCOL" });
    },
  );

  it("rejects URLs with credentials", () => {
    expect(validateFeedUrl("https://user:pass@example.com/feed")).toMatchObject({ ok: false, code: "INVALID_URL" });
  });

  it.each([
    ["http://localhost:3000/feed"],
    ["http://127.0.0.1/feed"],
    ["http://10.0.0.5/feed"],
    ["http://192.168.1.1/feed"],
    ["http://172.16.0.1/feed"],
    ["http://169.254.169.254/latest/meta-data"],
    ["http://[::1]/feed"],
    ["http://2130706433/feed"], // 127.0.0.1 written as a number
    ["http://printer.local/feed"],
  ])("blocks local and private hosts: %s", (input) => {
    expect(validateFeedUrl(input)).toMatchObject({ ok: false, code: "BLOCKED_HOST" });
  });
});

describe("isBlockedHostname", () => {
  it("allows public hostnames and IPs", () => {
    expect(isBlockedHostname("example.com")).toBe(false);
    expect(isBlockedHostname("8.8.8.8")).toBe(false);
    expect(isBlockedHostname("172.32.0.1")).toBe(false);
  });

  it("blocks private IPv6 ranges", () => {
    expect(isBlockedHostname("[fd00::1]")).toBe(true);
    expect(isBlockedHostname("[fe80::1]")).toBe(true);
  });
});

describe("feedApiResponseSchema", () => {
  it("accepts a valid success response", () => {
    const result = feedApiResponseSchema.safeParse({
      success: true,
      feed: { title: "T", feedUrl: "https://example.com/feed" },
      items: [{ id: "1", title: "A", url: "https://example.com/a", summary: "" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid error response", () => {
    const result = feedApiResponseSchema.safeParse({
      success: false,
      error: { code: "TIMEOUT", message: "Too slow" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects unexpected shapes", () => {
    expect(feedApiResponseSchema.safeParse({ success: true }).success).toBe(false);
    expect(feedApiResponseSchema.safeParse({ success: false, error: { code: "NOPE", message: "" } }).success).toBe(false);
  });
});
