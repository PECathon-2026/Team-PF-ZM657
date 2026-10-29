// Tests for lib/validation.ts. Run with: npm test
// Numbers in test names match the Stage 2 URL validation test list.
import { describe, expect, it } from "vitest";
import { feedApiResponseSchema, isBlockedHostname, MAX_URL_LENGTH, validateFeedUrl } from "@/lib/validation";

describe("validateFeedUrl", () => {
  it("1. accepts a valid HTTPS URL", () => {
    expect(validateFeedUrl("https://jvns.ca/atom.xml")).toEqual({ ok: true, url: "https://jvns.ca/atom.xml" });
  });

  it("2. accepts a valid HTTP URL", () => {
    expect(validateFeedUrl("http://example.com/rss")).toEqual({ ok: true, url: "http://example.com/rss" });
  });

  it("3. trims whitespace (and removes #fragments)", () => {
    expect(validateFeedUrl("  \t https://example.com/feed#top \n ")).toEqual({ ok: true, url: "https://example.com/feed" });
  });

  it.each([[""], ["   "], [undefined], [null], [42], [{}]])("4. rejects empty or non-string input: %s", (input) => {
    expect(validateFeedUrl(input)).toMatchObject({ ok: false, code: "INVALID_URL" });
  });

  it.each([["not a url"], ["example.com/feed"], ["https://"], ["http//missing-colon.com"], ["https://exa mple.com"]])(
    "5. rejects malformed URLs: %s",
    (input) => {
      expect(validateFeedUrl(input)).toMatchObject({ ok: false, code: "INVALID_URL" });
    },
  );

  it.each([
    ["6. FTP", "ftp://example.com/feed.xml"],
    ["7. file", "file:///etc/passwd"],
    ["8. JavaScript", "javascript:alert(1)"],
    ["8. JavaScript (mixed case)", "JaVaScRiPt:alert(1)"],
    ["9. data", "data:text/xml,<rss/>"],
    ["blob", "blob:https://example.com/550e8400-e29b-41d4-a716-446655440000"],
  ])("%s protocol is rejected", (_label, input) => {
    expect(validateFeedUrl(input)).toMatchObject({ ok: false, code: "UNSUPPORTED_PROTOCOL" });
  });

  it.each([["https://user:pass@example.com/feed"], ["https://user@example.com/feed"], ["https://:secret@example.com/"]])(
    "10. rejects embedded credentials: %s",
    (input) => {
      expect(validateFeedUrl(input)).toMatchObject({ ok: false, code: "INVALID_URL" });
    },
  );

  it.each([["http://localhost/feed"], ["http://localhost:3000/feed"], ["http://LOCALHOST./feed"], ["http://app.localhost/feed"]])(
    "11. rejects localhost: %s",
    (input) => {
      expect(validateFeedUrl(input)).toMatchObject({ ok: false, code: "BLOCKED_HOST" });
    },
  );

  it.each([["http://127.0.0.1/feed"], ["http://127.1.2.3:8080/"], ["http://[::1]/feed"], ["http://0.0.0.0/"], ["http://2130706433/feed"], ["http://0x7f000001/"]])(
    "12. rejects loopback addresses: %s",
    (input) => {
      expect(validateFeedUrl(input)).toMatchObject({ ok: false, code: "BLOCKED_HOST" });
    },
  );

  it.each([
    ["http://10.0.0.5/feed"],
    ["http://172.16.0.1/feed"],
    ["http://172.31.255.255/feed"],
    ["http://192.168.1.1/feed"],
    ["http://169.254.169.254/latest/meta-data"], // cloud metadata service
    ["http://100.64.0.1/"],
    ["http://[fd00::1]/"],
    ["http://[fe80::1]/"],
    ["http://[::ffff:192.168.0.1]/"],
    ["http://printer.local/feed"],
    ["http://db.internal/feed"],
  ])("13. rejects private-network addresses: %s", (input) => {
    expect(validateFeedUrl(input)).toMatchObject({ ok: false, code: "BLOCKED_HOST" });
  });

  it("14. rejects excessively long URLs", () => {
    const tooLong = "https://example.com/" + "a".repeat(MAX_URL_LENGTH);
    expect(validateFeedUrl(tooLong)).toMatchObject({ ok: false, code: "INVALID_URL", message: "This URL is too long." });
    const justRight = "https://example.com/" + "a".repeat(MAX_URL_LENGTH - "https://example.com/".length);
    expect(validateFeedUrl(justRight)).toMatchObject({ ok: true });
  });

  it("never throws, even for strange input", () => {
    for (const input of [Symbol("x"), () => "https://example.com", new Date(), [], "\u0000"]) {
      expect(() => validateFeedUrl(input)).not.toThrow();
      expect(validateFeedUrl(input).ok).toBe(false);
    }
  });
});

describe("isBlockedHostname", () => {
  it("allows public hostnames and public IPs", () => {
    expect(isBlockedHostname("example.com")).toBe(false);
    expect(isBlockedHostname("8.8.8.8")).toBe(false);
    expect(isBlockedHostname("172.32.0.1")).toBe(false); // just outside 172.16.0.0/12
    expect(isBlockedHostname("[2606:4700::1111]")).toBe(false);
  });
});

describe("feedApiResponseSchema", () => {
  it("accepts a valid success response, including optional new fields", () => {
    const result = feedApiResponseSchema.safeParse({
      success: true,
      feed: { title: "T", feedUrl: "https://example.com/feed" },
      items: [{ id: "1", title: "A", url: "https://example.com/a", summary: "", categories: ["x"], updatedAt: "2026-01-01T00:00:00.000Z" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid error response", () => {
    expect(feedApiResponseSchema.safeParse({ success: false, error: { code: "TIMEOUT", message: "Too slow" } }).success).toBe(true);
  });

  it("rejects unexpected shapes", () => {
    expect(feedApiResponseSchema.safeParse({ success: true }).success).toBe(false);
    expect(feedApiResponseSchema.safeParse({ success: false, error: { code: "NOPE", message: "" } }).success).toBe(false);
  });
});
