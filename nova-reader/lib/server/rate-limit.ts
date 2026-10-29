// Rate limiting for the feed route.
// Runs on the SERVER only.
//
// MVP PLACEHOLDER: the in-memory limiter below only protects ONE server
// process. On serverless hosting (e.g. Vercel) each instance has its own memory,
// and memory is lost on restarts, so the real limit is "per instance".
// For production, implement `RateLimiter` with a shared store (e.g. Redis /
// Upstash, or the hosting provider's firewall rules). The route only depends on
// the interface, so nothing else needs to change.

import "server-only";
import { createHash, randomBytes } from "node:crypto";

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** Anything that can answer "may this client make another request now?" */
export interface RateLimiter {
  check(key: string): RateLimitResult;
}

type Bucket = { count: number; resetAt: number };

/** Fixed-window counter kept in memory: `limit` requests per `windowMs` per key. */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000, // memory cap
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): RateLimitResult {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (this.buckets.size >= this.maxKeys) this.removeExpired(now);
      if (this.buckets.size >= this.maxKeys) {
        // Still full: refuse instead of growing memory without bound.
        return { allowed: false, retryAfterSeconds: Math.ceil(this.windowMs / 1000) };
      }
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count <= this.limit) return { allowed: true };
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }

  private removeExpired(now: number): void {
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
  }
}

/** Shared limiter for GET /api/feed: 30 requests per minute per client. */
export const feedRateLimiter: RateLimiter = new InMemoryRateLimiter(30, 60_000);

/** Separate limiter for GET /api/article (Stage 6): 30 article pages per minute per client. */
export const articleRateLimiter: RateLimiter = new InMemoryRateLimiter(30, 60_000);

// A random salt per server process, so stored keys cannot be turned back into IPs.
const SALT = randomBytes(16).toString("hex");

/**
 * A privacy-friendly client key: a salted SHA-256 hash of the client IP.
 * The raw IP is never stored. The IP comes from proxy headers, which are only
 * trustworthy when the hosting platform sets them (Vercel does). Without a
 * trusted proxy, clients can fake these headers — see README.
 */
export function getClientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
  return createHash("sha256").update(SALT).update(ip).digest("hex").slice(0, 32);
}
