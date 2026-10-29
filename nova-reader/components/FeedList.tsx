// Shows the loaded feed: its title, description and the list of articles.
// Runs in the BROWSER (rendered inside the client page).

import { ExternalLink, Inbox } from "lucide-react";
import type { FeedInfo, FeedItem, ReadableArticle } from "@/lib/feed-types";
import { ArticleCard } from "./ArticleCard";
import { EmptyState } from "./EmptyState";

type FeedListProps = {
  feed: FeedInfo;
  items: FeedItem[];
  savedIds: Set<string>;
  onToggleSave: (article: ReadableArticle) => void;
  onRead: (article: ReadableArticle) => void;
};

export function FeedList({ feed, items, savedIds, onToggleSave, onRead }: FeedListProps) {
  return (
    <section aria-labelledby="feed-title" className="space-y-4">
      <header className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <h2 id="feed-title" className="font-serif text-2xl font-semibold text-ink">
          {feed.title}
        </h2>
        {feed.description && <p className="mt-1 text-ink-muted">{feed.description}</p>}
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
          <span>
            {items.length} {items.length === 1 ? "article" : "articles"}
          </span>
          {feed.siteUrl && (
            <a
              href={feed.siteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-accent underline-offset-4 hover:underline"
            >
              Visit website
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
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
