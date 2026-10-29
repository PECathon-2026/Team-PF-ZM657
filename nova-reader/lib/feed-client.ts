// Browser-side helper that loads a feed through OUR server route
// (GET /api/feed?url=...). The browser never fetches feed URLs directly.
// Runs in the BROWSER. The shared request logic lives in lib/api-request.ts.

import { apiFailure, getApiJson, type ApiFailure, type ApiRequestOptions } from "./api-request";
import type { FeedInfo, FeedItem } from "./feed-types";
import { feedApiResponseSchema, validateFeedUrl } from "./validation";

export type { ClientErrorCode } from "./api-request";

export type FeedLoadResult = { ok: true; feed: FeedInfo; items: FeedItem[] } | ApiFailure;

export type LoadFeedOptions = ApiRequestOptions;

/** Builds the API path with the feed URL safely encoded. */
export function buildFeedApiUrl(feedUrl: string): string {
  return `/api/feed?url=${encodeURIComponent(feedUrl)}`;
}

/**
 * Loads and checks a feed. Never throws: every outcome is a FeedLoadResult.
 * Steps: validate the URL → call /api/feed → check the JSON shape with Zod.
 */
export async function loadFeed(feedUrl: string, options: LoadFeedOptions = {}): Promise<FeedLoadResult> {
  const checked = validateFeedUrl(feedUrl);
  if (!checked.ok) return apiFailure(checked.code, checked.message);

  const result = await getApiJson(buildFeedApiUrl(checked.url), feedApiResponseSchema, options);
  if (!result.ok) return result;
  return { ok: true, feed: result.data.feed, items: result.data.items };
}
