// Tests for app/api/[...path]/route.ts (unknown /api paths).
import { describe, expect, it } from "vitest";
import { DELETE, GET, PATCH, POST, PUT } from "@/app/api/[...path]/route";

const handlers = { GET, POST, PUT, PATCH, DELETE } as const;

describe("unknown /api path catch-all", () => {
  it("returns the same JSON 404 for GET, POST, PUT, PATCH and DELETE", async () => {
    for (const [method, handler] of Object.entries(handlers)) {
      const response = handler();
      expect(response.status, method).toBe(404);
      expect(response.headers.get("content-type"), method).toContain("application/json");
      expect(response.headers.get("cache-control"), method).toBe("no-store");
      expect(response.headers.get("x-content-type-options"), method).toBe("nosniff");
      expect(response.headers.get("content-security-policy"), method).toContain("default-src 'none'");
      expect(await response.json(), method).toEqual({
        success: false,
        error: { code: "NOT_FOUND", message: "This API endpoint does not exist." },
      });
    }
  });

  it("does not include stack traces or internal paths in the body", async () => {
    const text = await GET().text();
    expect(text).not.toMatch(/stack trace|route\.ts|\/lib\/server/i);
  });
});
