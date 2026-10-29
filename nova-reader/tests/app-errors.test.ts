// Tests for Stage 9 error handling: lib/app-errors.ts, lib/log.ts and the
// catch-all JSON 404 for unknown /api paths.
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as unknownApiGet, POST as unknownApiPost } from "@/app/api/[...path]/route";
import { API_ERROR_CODES } from "@/lib/feed-types";
import { AI_ERROR_CODES } from "@/lib/ai/protocol";
import { APP_ERROR_MESSAGES, describeForLog, redact, toAppError, toAppErrorCode } from "@/lib/app-errors";
import { logError } from "@/lib/log";

afterEach(() => vi.restoreAllMocks());

describe("toAppErrorCode", () => {
  it("maps every existing API and AI code to a stable app code (none fall through to UNKNOWN by accident)", () => {
    const unknownOnPurpose = new Set(["INTERNAL_ERROR"]);
    for (const code of [...API_ERROR_CODES, ...AI_ERROR_CODES]) {
      const mapped = toAppErrorCode(code);
      if (unknownOnPurpose.has(code) || code === "CANCELLED") expect(mapped).toBe("UNKNOWN");
      else expect(mapped, code).not.toBe("UNKNOWN");
    }
  });

  it.each([
    ["BLOCKED_HOST", "VALIDATION"],
    ["FETCH_FAILED", "NETWORK"],
    ["CLIENT_TIMEOUT", "TIMEOUT"],
    ["RATE_LIMITED", "RATE_LIMITED"],
    ["QUOTA_EXCEEDED", "STORAGE"],
    ["NO_ARTICLE_FOUND", "EXTRACTION"],
    ["OUT_OF_MEMORY", "LOCAL_AI"],
    ["UNSUPPORTED", "UNSUPPORTED"],
    ["NOT_FOUND", "NOT_FOUND"],
    ["something-new", "UNKNOWN"],
  ])("%s → %s", (code, expected) => {
    expect(toAppErrorCode(code)).toBe(expected);
  });
});

describe("toAppError", () => {
  it("never uses the raw error message", () => {
    const error = new Error("ENOENT: /srv/app/.env DATABASE_URL=postgres://admin:hunter2@db/prod");
    const result = toAppError(error);
    expect(result).toEqual({ code: "UNKNOWN", message: APP_ERROR_MESSAGES.UNKNOWN, retryable: true });
    expect(JSON.stringify(result)).not.toMatch(/srv|env|hunter2|postgres/);
  });

  it("recognises coded errors, storage errors, timeouts and chunk-load failures", () => {
    expect(toAppError({ code: "TIMEOUT" })).toMatchObject({ code: "TIMEOUT", retryable: true });
    expect(toAppError({ name: "LocalStorageError", kind: "QUOTA_EXCEEDED" }).code).toBe("STORAGE");
    expect(toAppError(new DOMException("x", "TimeoutError")).code).toBe("TIMEOUT");
    expect(toAppError(Object.assign(new Error("Loading chunk 3 failed"), { name: "ChunkLoadError" })).code).toBe("NETWORK");
    expect(toAppError({ code: "BLOCKED_HOST" })).toMatchObject({ code: "VALIDATION", retryable: false });
  });

  it("handles values that are not errors", () => {
    expect(toAppError(undefined).code).toBe("UNKNOWN");
    expect(toAppError("boom").code).toBe("UNKNOWN");
  });
});

describe("redact / describeForLog", () => {
  it("removes credentials and query strings from URLs", () => {
    expect(redact("fetch https://user:pa55@blog.example/feed?token=abc123#x failed")).toBe(
      "fetch https://[credentials]@blog.example/feed?[redacted] failed",
    );
    expect(redact("GET https://blog.example/a?session=s3cr3t")).not.toContain("s3cr3t");
  });

  it("removes KEY=value secrets and bearer tokens", () => {
    expect(redact("boot failed: SECRET_KEY=abc123 API_TOKEN: xyz password=hunter2")).toBe(
      "boot failed: SECRET_KEY=[redacted] API_TOKEN=[redacted] password=[redacted]",
    );
    expect(redact("Authorization: Bearer eyJhbGciOi.payload.sig")).not.toContain("eyJ");
  });

  it("removes file paths and limits length", () => {
    expect(redact("at handler (/srv/app/lib/server/handler.ts:42:7)")).not.toMatch(/srv|handler\.ts/);
    expect(redact("C:\\Users\\slamb\\PECathon\\nova-reader\\lib\\db.ts broke")).not.toContain("slamb");
    expect(redact("x".repeat(1000)).length).toBe(200);
  });

  it("describes errors without stack traces", () => {
    const error = new TypeError("bad thing");
    error.stack = "TypeError: bad thing\n    at secret (/srv/app/x.ts:1:1)";
    expect(describeForLog(error)).toBe("TypeError: bad thing");
    expect(describeForLog({ weird: true })).toBe("non-error value thrown");
  });
});

describe("logError", () => {
  it("logs one safe line: scope, code, redacted description", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const articleText = "Secret article body ".repeat(50);
    logError("api/feed", Object.assign(new Error(`failed for https://x.example/p?key=zzz ${articleText}`), { code: "FETCH_FAILED" }));
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0][0]);
    expect(line.startsWith("[nova:api/feed] NETWORK Error: failed for https://x.example/p?[redacted]")).toBe(true);
    expect(line).not.toContain("zzz");
    expect(line.length).toBeLessThan(260); // article text is cut off
    expect(spy.mock.calls[0]).toHaveLength(1); // no raw error object (no stack) passed to the console
  });
});

describe("unknown /api paths", () => {
  it("return the safe JSON error shape with 404 for every method", async () => {
    for (const handler of [unknownApiGet, unknownApiPost]) {
      const response = handler();
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toEqual({ success: false, error: { code: "NOT_FOUND", message: "This API endpoint does not exist." } });
    }
  });
});
