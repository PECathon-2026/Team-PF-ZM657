"use client";
// The home page and the "brain" of the UI.
// Runs in the BROWSER ("use client"), because it uses state, events and IndexedDB.
//
// Data flow:
//   FeedForm → requestFeed() → lib/feed-client.ts → GET /api/feed → FeedList
//   Save button → lib/db.ts (IndexedDB) → SavedArticles
//   Every loaded feed → lib/db.ts cacheFeed() → shown again when offline / on next visit
//   LanguagePreferencesPrompt → preferred reading languages → inline & reader translation
//   VoiceAssistant ("Hey Nova") → hands-free keyword search & spoken headings

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bookmark, Cpu, Newspaper, Radar as RadarIcon, Rss, ShieldCheck } from "lucide-react";
import { AIWorkspace } from "@/components/AIWorkspace";
import { EmptyState } from "@/components/EmptyState";
import { FeedForm } from "@/components/FeedForm";
import { FeedList, FeedListSkeleton, formatDateTime } from "@/components/FeedList";
import { LanguagePreferenceButton, LanguagePreferencesPrompt } from "@/components/LanguagePreferences";
import { LocalAiProvider } from "@/components/LocalAiProvider";
import { OfflineCopies } from "@/components/OfflineCopies";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { ReaderView } from "@/components/ReaderView";
import { SavedArticles } from "@/components/SavedArticles";
import { StatusMessage, type StatusKind } from "@/components/StatusMessage";
import { ThemeToggle } from "@/components/ThemeProvider";
import { VoiceAssistant } from "@/components/VoiceAssistant";
import {
  cacheFeed,
  clearOfflineCopies as clearOfflineCopiesInDb,
  countCachedFeeds,
  countExtractedArticles,
  getCachedFeed,
  getLatestCachedFeed,
  getSavedArticles,
  removeSavedArticle,
  saveArticle,
} from "@/lib/db";
import { loadFeed } from "@/lib/feed-client";
import type { CachedFeed, FeedInfo, FeedItem, ReadableArticle, SavedArticle } from "@/lib/feed-types";

// `retryUrl` is set when trying the same URL again might help.
type Status = { kind: StatusKind; message: string; retryUrl?: string } | null;

/** The feed on screen. `cachedAt` is set when it is an offline copy. */
type ShownFeed = { info: FeedInfo; items: FeedItem[]; cachedAt?: string };

/** Mobile viewport section tabs (< 1024px) for zero-clutter touch navigation. */
type MobileTab = "feed" | "saved" | "tools";

export default function HomePage() {
  const [feed, setFeed] = useState<ShownFeed | null>(null);
  const [isLoadingFeed, setIsLoadingFeed] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>("feed");

  // Saved articles from IndexedDB.
  const [saved, setSaved] = useState<SavedArticle[]>([]);
  const [isLoadingSaved, setIsLoadingSaved] = useState(true);
  const [savedError, setSavedError] = useState<string | null>(null);

  // Offline feed copies in IndexedDB.
  const [cachedCount, setCachedCount] = useState(0);
  const [storedArticleCount, setStoredArticleCount] = useState(0);
  const [isClearingCache, setIsClearingCache] = useState(false);

  // The article open in the reading view (null = closed).
  const [readingArticle, setReadingArticle] = useState<ReadableArticle | null>(null);

  // The request in progress, so a newer request (or leaving the page) can cancel it.
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => () => activeRequest.current?.abort(), []);

  // When the page opens: load saved articles, show the last offline copy
  // instantly, then (if online) check for new articles in the background.
  const onLatestCachedFeed = useEffectEvent((latest: CachedFeed | undefined) => {
    if (!latest) return;
    showCachedFeed(latest, navigator.onLine ? "Checking for new articles…" : "You are offline.");
    if (navigator.onLine) void requestFeed(latest.requestedUrl, { background: true });
  });
  useEffect(() => {
    getSavedArticles()
      .then(setSaved)
      .catch((error: Error) => setSavedError(error.message))
      .finally(() => setIsLoadingSaved(false));
    countCachedFeeds().then(setCachedCount).catch(() => {});
    countExtractedArticles().then(setStoredArticleCount).catch(() => {});
    getLatestCachedFeed().then(onLatestCachedFeed).catch(() => {});
  }, []);

  function showCachedFeed(cached: CachedFeed, prefix: string, retryUrl?: string) {
    setFeed({ info: cached.feed, items: cached.items, cachedAt: cached.cachedAt });
    setStatus({
      kind: "info",
      message: `${prefix} Showing your offline copy from ${formatDateTime(cached.cachedAt)}.`,
      retryUrl,
    });
  }

  /** Shows the offline copy of `url` if there is one. Returns false if there is none. */
  async function tryOfflineCopy(url: string, prefix: string): Promise<boolean> {
    const cached = await getCachedFeed(url).catch(() => undefined);
    if (!cached) return false;
    showCachedFeed(cached, prefix, url);
    return true;
  }

  async function requestFeed(url: string, options: { background?: boolean } = {}) {
    if (!options.background) setMobileTab("feed");
    // navigator.onLine is read directly so this is always the current value.
    if (!navigator.onLine) {
      if (await tryOfflineCopy(url, "You are offline.")) return;
      setStatus({
        kind: "error",
        message: "You are offline and this feed has no offline copy yet. Your saved articles are still available.",
        retryUrl: url,
      });
      return;
    }

    // Cancel any older request so its answer cannot replace this one.
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;

    setIsLoadingFeed(true);
    if (!options.background) setStatus({ kind: "loading", message: "Loading feed…" });

    const result = await loadFeed(url, { signal: controller.signal });
    if (controller.signal.aborted) return; // a newer request took over

    activeRequest.current = null;
    setIsLoadingFeed(false);

    if (result.ok) {
      setFeed({ info: result.feed, items: result.items });
      const loaded = `${options.background ? "Updated: " : "Loaded "}${result.items.length} ${
        result.items.length === 1 ? "article" : "articles"
      } from ${result.feed.title}.`;
      setStatus({ kind: "success", message: loaded });
      try {
        await cacheFeed(url, result.feed, result.items);
        setCachedCount(await countCachedFeeds());
      } catch (error) {
        // The feed is still shown; only the offline copy failed.
        if (activeRequest.current) return; // a newer request owns the status message now
        const reason = error instanceof Error ? error.message : "Local storage failed.";
        setStatus({ kind: "info", message: `${loaded} An offline copy could not be kept: ${reason}` });
      }
      return;
    }

    // Connection problems (or a failed background update): fall back to the offline copy.
    const connectionProblem = result.code === "NETWORK_ERROR" || result.code === "CLIENT_TIMEOUT";
    if ((connectionProblem || options.background) && (await tryOfflineCopy(url, result.message))) return;

    setStatus({ kind: "error", message: result.message, retryUrl: result.retryable ? url : undefined });
  }

  /** Closing the reader may have stored a new full article, so refresh the count. */
  function closeReader() {
    setReadingArticle(null);
    countExtractedArticles().then(setStoredArticleCount).catch(() => {});
  }

  async function clearOfflineCopies() {
    setIsClearingCache(true);
    try {
      await clearOfflineCopiesInDb();
      setCachedCount(0);
      setStoredArticleCount(await countExtractedArticles()); // full text of saved articles is kept
      setStatus({ kind: "success", message: "Offline copies were deleted from this device. Saved articles were kept." });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Could not clear offline copies." });
    } finally {
      setIsClearingCache(false);
    }
  }

  async function toggleSave(article: ReadableArticle) {
    const isSaved = saved.some((item) => item.id === article.id);
    try {
      if (isSaved) {
        await removeSavedArticle(article.id);
        setSaved((current) => current.filter((item) => item.id !== article.id));
      } else {
        const savedArticle = await saveArticle(article, article.feedTitle ?? feed?.info.title ?? "Unknown feed");
        setSaved((current) => [savedArticle, ...current]);
      }
      setSavedError(null);
    } catch (error) {
      setSavedError(error instanceof Error ? error.message : "Local storage failed.");
    }
  }

  const savedIds = new Set(saved.map((item) => item.id));
  const retryUrl = isLoadingFeed ? undefined : status?.retryUrl;

  const voiceArticles = useMemo<ReadableArticle[]>(() => {
    const feedArticles: ReadableArticle[] = feed
      ? feed.items.map((item) => ({ ...item, feedTitle: feed.info.title }))
      : [];
    const seen = new Set(feedArticles.map((a) => a.id));
    const extras = saved.filter((s) => !seen.has(s.id));
    return [...feedArticles, ...extras];
  }, [feed, saved]);

  return (
    <LocalAiProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-xl focus:bg-surface focus:px-4 focus:py-2.5 focus:font-medium focus:shadow-md"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2.5 font-serif text-xl font-bold tracking-tight text-ink sm:text-2xl">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-ink shadow-xs">
                <Rss aria-hidden="true" className="size-4" />
              </span>
              <span>NOVA Reader</span>
            </h1>
            <p className="mt-0.5 text-xs text-ink-muted sm:text-sm">
              Independent, offline-first reading for RSS &amp; Atom feeds.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <VoiceAssistant currentArticles={voiceArticles} onOpenArticle={setReadingArticle} />
            <LanguagePreferenceButton />
            <ThemeToggle />
            <Link
              href="/radar"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent whitespace-nowrap shrink-0"
            >
              <RadarIcon aria-hidden="true" className="size-4 text-accent" />
              <span>Knowledge Radar</span>
            </Link>
            <OfflineIndicator />
          </div>
        </div>
      </header>

      {/* First-visit preferred language(s) prompt + on-demand language selector */}
      <LanguagePreferencesPrompt />

      {/* Mobile-only workspace switcher (< 1024px) for thumb-friendly responsive layout */}
      <nav aria-label="Workspace sections" className="mx-auto max-w-6xl px-4 pt-4 sm:px-6 lg:hidden">
        <div className="grid grid-cols-3 gap-1.5 rounded-2xl border border-line bg-surface p-1.5">
          <button
            type="button"
            aria-pressed={mobileTab === "feed"}
            onClick={() => setMobileTab("feed")}
            className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-medium transition-colors ${
              mobileTab === "feed" ? "bg-accent text-accent-ink font-semibold" : "text-ink-muted hover:text-ink"
            }`}
          >
            <Newspaper aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">Feed</span>
          </button>
          <button
            type="button"
            aria-pressed={mobileTab === "saved"}
            onClick={() => setMobileTab("saved")}
            className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-medium transition-colors tabular-nums ${
              mobileTab === "saved" ? "bg-accent text-accent-ink font-semibold" : "text-ink-muted hover:text-ink"
            }`}
          >
            <Bookmark aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">Saved{saved.length > 0 ? ` (${saved.length})` : ""}</span>
          </button>
          <button
            type="button"
            aria-pressed={mobileTab === "tools"}
            onClick={() => setMobileTab("tools")}
            className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-medium transition-colors ${
              mobileTab === "tools" ? "bg-accent text-accent-ink font-semibold" : "text-ink-muted hover:text-ink"
            }`}
          >
            <Cpu aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">AI &amp; Offline</span>
          </button>
        </div>
      </nav>

      <main id="main" className="mx-auto grid max-w-6xl gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className={`min-w-0 space-y-4 ${mobileTab !== "feed" ? "max-lg:hidden" : ""}`}>
          <FeedForm onSubmit={requestFeed} isLoading={isLoadingFeed} />
          {status && (
            <StatusMessage
              kind={status.kind}
              message={status.message}
              action={retryUrl ? { label: "Try again", onClick: () => requestFeed(retryUrl) } : undefined}
            />
          )}

          {/* aria-busy only on the results, so the status message above is still announced. */}
          <div aria-busy={isLoadingFeed}>
            {isLoadingFeed && !feed ? (
              <FeedListSkeleton />
            ) : feed ? (
              <FeedList
                feed={feed.info}
                items={feed.items}
                savedIds={savedIds}
                cachedAt={feed.cachedAt}
                onToggleSave={toggleSave}
                onRead={setReadingArticle}
              />
            ) : (
              <EmptyState
                icon={Rss}
                title="No feed loaded yet"
                message="Paste an RSS or Atom feed URL above to load its latest articles privately."
              />
            )}
          </div>
        </div>

        <aside
          className={`space-y-6 ${mobileTab === "feed" ? "max-lg:hidden" : ""}`}
          aria-label="Saved articles and local features"
        >
          <div className={mobileTab === "tools" ? "max-lg:hidden" : ""}>
            <SavedArticles
              articles={saved}
              isLoading={isLoadingSaved}
              error={savedError}
              onRemove={toggleSave}
              onRead={setReadingArticle}
            />
          </div>
          <div className={`space-y-6 ${mobileTab === "saved" ? "max-lg:hidden" : ""}`}>
            <OfflineCopies
              count={cachedCount}
              articleCount={storedArticleCount}
              onClear={clearOfflineCopies}
              isClearing={isClearingCache}
            />
            <AIWorkspace />
          </div>
        </aside>
      </main>

      <footer className="mx-auto max-w-6xl border-t border-line/60 px-4 py-8 sm:px-6">
        <p className="flex items-start gap-2.5 text-sm leading-relaxed text-ink-muted">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
          <span>
            No accounts, no tracking. Saved articles and language preferences stay in this browser. Feeds are fetched
            through this app&apos;s server without storing your reading history.
          </span>
        </p>
      </footer>

      <ReaderView article={readingArticle} onClose={closeReader} />
    </LocalAiProvider>
  );
}
