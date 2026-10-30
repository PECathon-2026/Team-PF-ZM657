// Shows the loaded feed: its title, description and the list of articles.
// Runs in the BROWSER (rendered inside the client page).

import { ExternalLink, HardDrive, Inbox } from "lucide-react";
import type { FeedInfo, FeedItem, ReadableArticle } from "@/lib/feed-types";
import { ArticleCard } from "./ArticleCard";
import { EmptyState } from "./EmptyState";

type FeedListProps = {
  feed: FeedInfo;
  items: FeedItem[];
  savedIds: Set<string>;
  /** Set when this is an offline copy from IndexedDB, not a fresh download. */
  cachedAt?: string;
  onToggleSave: (article: ReadableArticle) => void;
  onRead: (article: ReadableArticle) => void;
};

export function FeedList({ feed, items, savedIds, cachedAt, onToggleSave, onRead }: FeedListProps) {
  return (
    <section aria-labelledby="feed-title" className="space-y-4">
      <header className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
        <h2 id="feed-title" className="font-serif text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {feed.title}
        </h2>
        {feed.description && <p className="mt-1.5 leading-relaxed text-ink-muted">{feed.description}</p>}
        <p className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-ink-muted tabular-nums">
          <span>
            {items.length} {items.length === 1 ? "article" : "articles"}
          </span>
          {cachedAt && (
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5 text-ink">
                <HardDrive aria-hidden="true" className="size-3.5 text-warning" />
                Offline copy from <time dateTime={cachedAt}>{formatDateTime(cachedAt)}</time>
              </span>
            </>
          )}
          {feed.siteUrl && (
            <>
              <span aria-hidden="true">·</span>
              <a
                href={feed.siteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-accent underline-offset-4 hover:underline"
              >
                Visit website
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </a>
            </>
          )}
        </p>
      </header>

      {items.length === 0 ? (
        <EmptyState icon={Inbox} title="This feed has no articles" message="The feed loaded correctly but is empty right now." />
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id}>
              <ArticleCard
                article={{ ...item, feedTitle: feed.title }}
                isSaved={savedIds.has(item.id)}
                onToggleSave={onToggleSave}
                onRead={onRead}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** "30 Oct 2026, 14:05" in the reader's own locale. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "an earlier visit";
  return date.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Grey placeholder cards shown while a feed is loading. Hidden from screen readers. */
export function FeedListSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-3" data-testid="feed-skeleton">
      {[0, 1, 2].map((key) => (
        <div key={key} className="animate-pulse rounded-xl border border-line bg-surface p-4">
          <div className="h-5 w-2/3 rounded bg-surface-muted" />
          <div className="mt-3 h-3 w-1/3 rounded bg-surface-muted" />
          <div className="mt-4 h-3 w-full rounded bg-surface-muted" />
          <div className="mt-2 h-3 w-5/6 rounded bg-surface-muted" />
        </div>
      ))}
    </div>
  );
}
