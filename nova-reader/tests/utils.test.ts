// Tests for truncate() in lib/utils.ts (bugs.md #1). Run with: npm test
import { describe, expect, it } from "vitest";
import { truncate } from "@/lib/utils";

describe("truncate", () => {
  it("returns short text unchanged", () => {
    expect(truncate("hello", 5)).toBe("hello");
    expect(truncate("hello", 500)).toBe("hello");
    expect(truncate("", 3)).toBe("");
  });

  it("cuts long text and adds an ellipsis, never exceeding the limit", () => {
    expect(truncate("hello world", 6)).toBe("hello…");
    for (let limit = 1; limit <= 12; limit++) {
      expect(truncate("hello world!!", limit).length).toBeLessThanOrEqual(limit);
    }
  });

  it("does not leave a space before the ellipsis", () => {
    expect(truncate("hello world", 7)).toBe("hello…");
  });

  it("returns only the ellipsis when the limit is 1", () => {
    expect(truncate("hello", 1)).toBe("…");
  });

  it("returns an empty string for a limit of 0 (bug #1)", () => {
    expect(truncate("hello", 0)).toBe("");
    expect(truncate("a", 0)).toBe("");
    expect(truncate("", 0)).toBe("");
  });

  it("returns an empty string for negative and NaN limits instead of inventing text", () => {
    expect(truncate("hello", -1)).toBe("");
    expect(truncate("hello", -3)).toBe("");
    expect(truncate("hello", Number.NaN)).toBe("");
  });

  it("rounds fractional limits down", () => {
    expect(truncate("hello", 2.9)).toBe("h…");
    expect(truncate("hello", 0.5)).toBe("");
    expect(truncate("hello", 5.5)).toBe("hello");
  });

  it("treats Infinity as no limit", () => {
    expect(truncate("hello", Number.POSITIVE_INFINITY)).toBe("hello");
  });
});
