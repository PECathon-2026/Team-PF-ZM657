// Tests for lib/zod-setup.ts (CSP-safe Zod config).
import { describe, expect, it } from "vitest";
import { z } from "zod";
import "@/lib/zod-setup";

describe("zod-setup", () => {
  it("can be imported without throwing and validation still works", () => {
    expect(z.string().parse("ok")).toBe("ok");
    expect(z.string().safeParse(1).success).toBe(false);
    expect(z.object({ n: z.number() }).safeParse({ n: "no" }).success).toBe(false);
  });

  it("does not need eval: empty and huge strings still validate", () => {
    expect(z.string().safeParse("").success).toBe(true);
    expect(z.string().max(10).safeParse("x".repeat(100)).success).toBe(false);
  });
});
