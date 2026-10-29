"use client";
// The home page and the "brain" of the UI.
// Runs in the BROWSER ("use client"), because it uses state, events and IndexedDB.
//
// Data flow:
//   FeedForm → loadFeed() → GET /api/feed → FeedList
//   Save button → lib/db.ts (IndexedDB) → SavedArticles

import { useEffect, useState } from "react";
import { Rss, ShieldCheck } from "lucide-react";
import { AIWorkspacePlaceholder } from "@/components/AIWorkspacePlaceholder";
import { EmptyState } from "@/components/EmptyState";
import { FeedForm } from "@/components/FeedForm";
import { FeedList } from "@/components/FeedList";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { ReaderView } from "@/components/ReaderView";
import { SavedArticles } from "@/components/SavedArticles";
import { StatusMessage, type StatusKind } from "@/components/StatusMessage";
import { getSavedArticles, removeSavedArticle, saveArticle } from "@/lib/db";
import type { FeedInfo, FeedItem, ReadableArticle, SavedArticle } from "@/lib/feed-types";
import { useOnlineStatus } from "@/lib/use-online-status";
import { feedApiResponseSchema } from "@/lib/validation";

type Status = { kind: StatusKind; message: string } | null;

export default function HomePage() {
  const isOnline = useOnlineStatus();

  // The feed currently on screen.
  const [feed, setFeed] = useState<{ info: FeedInfo; items: FeedItem[] } | null>(null);
  const [isLoadingFeed, setIsLoadingFeed] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  // Saved articles from IndexedDB.
  const [saved, setSaved] = useState<SavedArticle[]>([]);
  const [isLoadingSaved, setIsLoadingSaved] = useState(true);
  const [savedError, setSavedError] = useState<string | null>(null);

  // The article open in the reading view (null = closed).
  const [readingArticle, setReadingArticle] = useState<ReadableArticle | null>(null);

  // Load saved articles once, when the page first opens.
  useEffect(() => {
    getSavedArticles()
      .then(setSaved)
      .catch((error: Error) => setSavedError(error.message))
      .finally(() => setIsLoadingSaved(false));
  }, []);

  async function loadFeed(url: string) {
    if (!isOnline) {
      setStatus({
        kind: "error",
        message: "You are offline, so new feeds cannot be loaded. Your saved articles are still available.",
      });
      return;
    }

    setIsLoadingFeed(true);
    setStatus({ kind: "loading", message: "Loading feed…" });

    try {
      const response = await fetch(`/api/feed?url=${encodeURIComponent(url)}`);
      const parsed = feedApiResponseSchema.safeParse(await response.json());

      if (!parsed.success) {
        setStatus({ kind: "error", message: "The server sent an unexpected response. Please try again." });
      } else if (!parsed.data.success) {
        setStatus({ kind: "error", message: parsed.data.error.message });
      } else {
        const { feed: info, items } = parsed.data;
        setFeed({ info, items });
        setStatus({
          kind: "success",
          message: `Loaded ${items.length} ${items.length === 1 ? "article" : "articles"} from ${info.title}.`,
        });
      }
    } catch {
      // fetch() itself failed: usually the connection dropped.
      setStatus({ kind: "error", message: "Could not reach the NOVA Reader server. Check your connection." });
    } finally {
      setIsLoadingFeed(false);
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

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-ink">
              <span className="grid size-8 place-items-center rounded-lg bg-accent text-white dark:text-bg">
                <Rss aria-hidden="true" className="size-4" />
              </span>
              NOVA Reader
            </h1>
            <p className="mt-0.5 text-sm text-ink-muted">A private, offline-friendly reader for independent blogs.</p>
          </div>
          <OfflineIndicator />
        </div>
      </header>

      <main id="main" className="mx-auto grid max-w-6xl gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <FeedForm onSubmit={loadFeed} isLoading={isLoadingFeed} />
          {status && <StatusMessage kind={status.kind} message={status.message} />}

          {feed ? (
            <FeedList
              feed={feed.info}
              items={feed.items}
              savedIds={savedIds}
              onToggleSave={toggleSave}
              onRead={setReadingArticle}
            />
          ) : (
            <EmptyState
              icon={Rss}
              title="No feed loaded yet"
              message="Paste a feed URL above, or pick one of the examples, to see its latest articles."
            />
          )}
        </div>

        <aside className="space-y-6" aria-label="Saved articles and planned features">
          <SavedArticles
            articles={saved}
            isLoading={isLoadingSaved}
            error={savedError}
            onRemove={toggleSave}
            onRead={setReadingArticle}
          />
          <AIWorkspacePlaceholder />
        </aside>
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-8 sm:px-6">
        <p className="flex items-start gap-2 text-sm text-ink-muted">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          No accounts, no tracking. Saved articles stay in this browser. Feeds are fetched through this app&apos;s server,
          which does not store them. Hackathon MVP — not production-ready.
        </p>
      </footer>

      <ReaderView article={readingArticle} onClose={() => setReadingArticle(null)} />
    </>
  );
}
