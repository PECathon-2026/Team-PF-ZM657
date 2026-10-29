// Tests for lib/server/errors.ts
import { describe, expect, it } from "vitest";
import { FeedRouteError, isTimeoutError } from "@/lib/server/errors";

describe("FeedRouteError", () => {
  it("stores a safe code, status and message", () => {
    const error = new FeedRouteError("TIMEOUT", 504, "The feed took too long to respond.");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("FeedRouteError");
    expect(error.code).toBe("TIMEOUT");
    expect(error.status).toBe(504);
    expect(error.message).toBe("The feed took too long to respond.");
  });
});

describe("isTimeoutError", () => {
  it("is true for TimeoutError and AbortError", () => {
    expect(isTimeoutError(Object.assign(new Error("aborted"), { name: "TimeoutError" }))).toBe(true);
    expect(isTimeoutError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
  });

  it("is false for other errors, FeedRouteError, and non-errors", () => {
    expect(isTimeoutError(new Error("connect ECONNREFUSED"))).toBe(false);
    expect(isTimeoutError(new FeedRouteError("TIMEOUT", 504, "The feed took too long to respond."))).toBe(false);
    expect(isTimeoutError(undefined)).toBe(false);
    expect(isTimeoutError("TimeoutError")).toBe(false);
    expect(isTimeoutError({ name: "TimeoutError" })).toBe(false);
  });
});
