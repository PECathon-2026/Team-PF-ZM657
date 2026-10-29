// React hook: gets a readable full version of an article for the reader view.
// Runs in the BROWSER.
//
// Order:
//   1. A version stored on this device (works offline, also for saved articles).
//   2. Otherwise, if online: download the page via /api/article, extract it with
//      Readability, and store it for next time.
// It never throws; failures come back as { status: "failed", message, retryable }.

import { useEffect, useState } from "react";
import { fetchArticlePage } from "./article-client";
import { extractReadableArticle } from "./article-extractor";
import { getExtractedArticle, storeExtractedArticle } from "./db";
import type { ExtractedArticle } from "./feed-types";

export type ExtractionState =
  | { status: "loading" }
  | { status: "ready"; article: ExtractedArticle; source: "stored" | "network"; storageWarning?: string }
  | { status: "failed"; message: string; retryable: boolean };

/** Does all the work for one article URL. Exported for tests. */
export async function getReadableArticle(articleUrl: string, signal: AbortSignal): Promise<ExtractionState> {
  const stored = await getExtractedArticle(articleUrl).catch(() => undefined);
  if (stored) return { status: "ready", article: stored, source: "stored" };

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return {
      status: "failed",
      message: "You are offline, and the full article has not been stored on this device yet.",
      retryable: true,
    };
  }

  const page = await fetchArticlePage(articleUrl, { signal });
  if (!page.ok) return { status: "failed", message: page.message, retryable: page.retryable };

  const extracted = extractReadableArticle(page.html, page.pageUrl, articleUrl);
  if (!extracted.ok) return { status: "failed", message: extracted.message, retryable: false };

  try {
    await storeExtractedArticle(extracted.article);
    return { status: "ready", article: extracted.article, source: "network" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Local storage failed.";
    return { status: "ready", article: extracted.article, source: "network", storageWarning: reason };
  }
}

/**
 * @param articleUrl The article to load, or null when the reader is closed.
 * @returns the current state and a `retry()` function.
 */
export function useArticleExtraction(articleUrl: string | null): { state: ExtractionState; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  // The result is remembered together with the URL and attempt it belongs to.
  // If they do not match (new article, or retry pressed), we are "loading".
  // This avoids setting state directly inside the effect.
  const [result, setResult] = useState<{ url: string; attempt: number; state: ExtractionState } | null>(null);

  useEffect(() => {
    if (!articleUrl) return;
    const controller = new AbortController();
    getReadableArticle(articleUrl, controller.signal).then((state) => {
      if (!controller.signal.aborted) setResult({ url: articleUrl, attempt, state });
    });
    return () => controller.abort(); // closing the reader cancels the download
  }, [articleUrl, attempt]);

  const state: ExtractionState =
    result && result.url === articleUrl && result.attempt === attempt ? result.state : { status: "loading" };
  return { state, retry: () => setAttempt((value) => value + 1) };
}
