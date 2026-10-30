// POST /api/audit-seeds
// High-speed, SSRF-protected batch Seed List Trap Auditor.
// Scans up to 60 seed URLs concurrently (concurrency = 6) so hackathon teams can
// paste an entire seed list or OPML file and pinpoint duplicate blogs or malformed
// XML feeds (with exact line/column numbers) in ~1–2 seconds.

import { NextResponse } from "next/server";
import {
  finalizeSeedAudit,
  inspectRawFeedXml,
  type AuditedSeedEntry,
} from "@/lib/seed-auditor";
import { FeedRouteError, isTimeoutError } from "@/lib/server/errors";
import { fetchFeedXml } from "@/lib/server/feed-fetcher";
import { getClientKey, InMemoryRateLimiter } from "@/lib/server/rate-limit";
import { SECURITY_HEADERS } from "@/lib/server/responses";
import { validateFeedUrl } from "@/lib/validation";

const MAX_SEED_URLS = 60;
const AUDIT_CONCURRENCY = 6;
const PER_SEED_TIMEOUT_MS = 8_500;

/** Separate batch limiter: 15 full seed-list scans per minute per client. */
const seedAuditLimiter = new InMemoryRateLimiter(15, 60_000);

type AuditSeedsRequestBody = {
  urls?: unknown;
};

async function auditOneSeedUrl(seedIndex: number, rawUrl: string): Promise<AuditedSeedEntry> {
  const startedAt = Date.now();
  const checked = validateFeedUrl(rawUrl);
  if (!checked.ok) {
    return {
      seedIndex,
      inputUrl: rawUrl,
      ok: false,
      errorCode: checked.code,
      errorMessage: checked.message,
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    const { xml, finalUrl } = await fetchFeedXml(checked.url, { timeoutMs: PER_SEED_TIMEOUT_MS });
    return inspectRawFeedXml(seedIndex, checked.url, xml, finalUrl, Date.now() - startedAt);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (error instanceof FeedRouteError) {
      return {
        seedIndex,
        inputUrl: checked.url,
        ok: false,
        errorCode: error.code,
        errorMessage: error.message,
        durationMs,
      };
    }
    if (isTimeoutError(error)) {
      return {
        seedIndex,
        inputUrl: checked.url,
        ok: false,
        errorCode: "TIMEOUT",
        errorMessage: "The feed server timed out before responding.",
        durationMs,
      };
    }
    return {
      seedIndex,
      inputUrl: checked.url,
      ok: false,
      errorCode: "FETCH_FAILED",
      errorMessage: "Could not connect to or read the feed endpoint.",
      durationMs,
    };
  }
}

export async function POST(request: Request): Promise<Response> {
  const clientKey = getClientKey(request);
  const limit = seedAuditLimiter.check(clientKey);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: `Too many batch seed audits. Please wait ${limit.retryAfterSeconds}s and try again.`,
        },
      },
      {
        status: 429,
        headers: { ...SECURITY_HEADERS, "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  let body: AuditSeedsRequestBody;
  try {
    body = (await request.json()) as AuditSeedsRequestBody;
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON request body." } },
      { status: 400, headers: SECURITY_HEADERS },
    );
  }

  if (!Array.isArray(body.urls)) {
    return NextResponse.json(
      { success: false, error: { code: "EMPTY_SEED_LIST", message: "Provide an array of seed URLs to scan." } },
      { status: 400, headers: SECURITY_HEADERS },
    );
  }

  const cleanedUrls = body.urls
    .filter((u): u is string => typeof u === "string")
    .map((u) => u.trim())
    .filter(Boolean)
    .slice(0, MAX_SEED_URLS);

  if (cleanedUrls.length === 0) {
    return NextResponse.json(
      { success: false, error: { code: "EMPTY_SEED_LIST", message: "Paste at least one feed URL to audit." } },
      { status: 400, headers: SECURITY_HEADERS },
    );
  }

  // Concurrency-controlled worker pool preserving exact 1-based seed indices
  const results = new Array<AuditedSeedEntry>(cleanedUrls.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= cleanedUrls.length) return;
      results[idx] = await auditOneSeedUrl(idx + 1, cleanedUrls[idx]);
    }
  }

  const workerCount = Math.min(AUDIT_CONCURRENCY, cleanedUrls.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const summary = finalizeSeedAudit(results);
  return NextResponse.json({ success: true, summary }, { status: 200, headers: SECURITY_HEADERS });
}
