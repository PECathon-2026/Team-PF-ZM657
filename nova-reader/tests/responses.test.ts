// Tests for lib/server/responses.ts
import { describe, expect, it } from "vitest";
import { errorJson, SECURITY_HEADERS } from "@/lib/server/responses";

describe("SECURITY_HEADERS", () => {
  it("marks responses as data, not a page", () => {
    expect(SECURITY_HEADERS).toMatchObject({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
    });
  });
});

describe("errorJson", () => {
  it("returns the shared failure shape with status and security headers", async () => {
    const response = errorJson("INVALID_URL", 400, "Please enter a feed URL.");
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(await response.json()).toEqual({
      success: false,
      error: { code: "INVALID_URL", message: "Please enter a feed URL." },
    });
  });

  it("lets callers add extra headers such as Retry-After", async () => {
    const response = errorJson("RATE_LIMITED", 429, "Too many requests.", { "Retry-After": "12" });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("12");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps an empty message as an empty string rather than substituting one", async () => {
    const response = errorJson("INTERNAL_ERROR", 500, "");
    expect(await response.json()).toEqual({ success: false, error: { code: "INTERNAL_ERROR", message: "" } });
  });

  it("does not leak extra fields into the JSON body", async () => {
    const json = await errorJson("FETCH_FAILED", 502, "Could not connect.").json();
    expect(Object.keys(json)).toEqual(["success", "error"]);
    expect(Object.keys((json as { error: object }).error)).toEqual(["code", "message"]);
  });
});
