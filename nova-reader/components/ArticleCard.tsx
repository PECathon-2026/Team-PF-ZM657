// One article in a list: title, date, author, short summary and actions.
// Runs in the BROWSER (rendered inside the client page).
//
// Safety: every value from the feed is rendered as plain text by React.
// We never use dangerouslySetInnerHTML. Remote images are not loaded,
// so blogs cannot track who is reading the list.

import { Bookmark, BookmarkCheck, BookOpen, ExternalLink } from "lucide-react";
import type { ReadableArticle } from "@/lib/feed-types";
import { formatDate } from "@/lib/utils";

type ArticleCardProps = {
  article: ReadableArticle;
  isSaved: boolean;
  onToggleSave: (article: ReadableArticle) => void;
  onRead: (article: ReadableArticle) => void;
  /** "compact" is used in the saved-articles sidebar. */
  variant?: "full" | "compact";
};

export function ArticleCard({ article, isSaved, onToggleSave, onRead, variant = "full" }: ArticleCardProps) {
  const date = formatDate(article.publishedAt);
  const headingId = `${variant}-article-${article.id}`; // unique even if shown twice
  const compact = variant === "compact";

  return (
    <article aria-labelledby={headingId} className="rounded-xl border border-line bg-surface p-4">
      <h3 id={headingId} className={`font-serif font-semibold leading-snug text-ink ${compact ? "text-base" : "text-lg"}`}>
        {article.title}
      </h3>

      <p className="mt-1 flex flex-wrap gap-x-2 text-sm text-ink-muted">
        {compact && article.feedTitle && <span>{article.feedTitle}</span>}
        {date && <time dateTime={article.publishedAt}>{date}</time>}
        {article.author && <span>by {article.author}</span>}
      </p>

      {!compact && article.summary && (
        <p className="mt-2 line-clamp-3 text-[0.95rem] leading-relaxed text-ink">{article.summary}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onRead(article)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium text-ink hover:border-accent hover:text-accent"
        >
          <BookOpen aria-hidden="true" className="size-4" />
          Read<span className="sr-only">: {article.title}</span>
        </button>

        <button
          type="button"
          onClick={() => onToggleSave(article)}
          aria-pressed={isSaved}
          className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium ${
            isSaved ? "border-accent bg-accent-soft text-ink" : "border-line text-ink hover:border-accent hover:text-accent"
          }`}
        >
          {isSaved ? (
            <BookmarkCheck aria-hidden="true" className="size-4 text-accent" />
          ) : (
            <Bookmark aria-hidden="true" className="size-4" />
          )}
          {isSaved ? (compact ? "Remove" : "Saved") : "Save"}
          <span className="sr-only">: {article.title}</span>
        </button>

        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-accent underline-offset-4 hover:underline"
        >
          Original
          <ExternalLink aria-hidden="true" className="size-3.5" />
          <span className="sr-only">(opens {article.title} in a new tab)</span>
        </a>
      </div>
    </article>
  );
}
