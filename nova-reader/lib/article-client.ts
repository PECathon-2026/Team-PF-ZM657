// Browser-side helper that downloads an article page through OUR server route
// (GET /api/article?url=...). Runs in the BROWSER.
// The HTML it returns is UNTRUSTED: pass it to lib/article-extractor.ts.

import { apiFailure, getApiJson, type ApiFailure, type ApiRequestOptions } from "./api-request";
import { articlePageApiResponseSchema, validateFeedUrl } from "./validation";

export type ArticlePageResult = { ok: true; pageUrl: string; html: string } | ApiFailure;

export function buildArticleApiUrl(articleUrl: string): string {
  return `/api/article?url=${encodeURIComponent(articleUrl)}`;
}

/** Downloads the article page. Never throws. */
export async function fetchArticlePage(articleUrl: string, options: ApiRequestOptions = {}): Promise<ArticlePageResult> {
  const checked = validateFeedUrl(articleUrl); // same URL rules as feeds
  if (!checked.ok) return apiFailure(checked.code, checked.message);

  const result = await getApiJson(buildArticleApiUrl(checked.url), articlePageApiResponseSchema, options);
  if (!result.ok) return result;
  return { ok: true, pageUrl: result.data.page.url, html: result.data.page.html };
}
