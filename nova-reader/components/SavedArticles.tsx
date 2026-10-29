// The "Saved on this device" section.
// Runs in the BROWSER. The list itself comes from IndexedDB (see lib/db.ts);
// this component only displays it.

import { Bookmark } from "lucide-react";
import type { ReadableArticle, SavedArticle } from "@/lib/feed-types";
import { ArticleCard } from "./ArticleCard";
import { EmptyState } from "./EmptyState";
import { StatusMessage } from "./StatusMessage";

type SavedArticlesProps = {
  articles: SavedArticle[];
  isLoading: boolean;
  error: string | null;
  onRemove: (article: ReadableArticle) => void;
  onRead: (article: ReadableArticle) => void;
};

export function SavedArticles({ articles, isLoading, error, onRemove, onRead }: SavedArticlesProps) {
  return (
    <section aria-labelledby="saved-title" className="space-y-3">
      <div>
        <h2 id="saved-title" className="text-lg font-semibold text-ink">
          Saved on this device{articles.length > 0 && <span className="text-ink-muted"> ({articles.length})</span>}
        </h2>
        <p className="text-sm text-ink-muted">Stored only in this browser. Available offline.</p>
      </div>

      {error && <StatusMessage kind="error" message={error} />}

      {isLoading ? (
        <StatusMessage kind="loading" message="Loading saved articles…" />
      ) : articles.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title="No saved articles yet"
          message="Press “Save” on any article to keep it here, even after you refresh or go offline."
        />
      ) : (
        <ul className="space-y-3">
          {articles.map((article) => (
            <li key={article.id}>
              <ArticleCard article={article} isSaved onToggleSave={onRemove} onRead={onRead} variant="compact" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
