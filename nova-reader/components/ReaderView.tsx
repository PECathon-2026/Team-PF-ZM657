"use client";
// The readable view: a calm, full-height panel showing one article.
// Runs in the BROWSER.
//
// It uses the browser's built-in <dialog> element, which gives us keyboard
// support for free: focus moves into the dialog, and Escape closes it.
//
// Content (Stage 6):
//   1. The feed's own text is shown immediately.
//   2. The full article is loaded (stored copy first, else /api/article +
//      Readability) and shown when ready, with a button to switch back.
//   3. If that fails, a clear message explains why and the feed text stays.
// All HTML goes through DOMPurify (ArticleContent → lib/sanitize-html.ts).

import { useEffect, useRef, useState } from "react";
import { BookOpen, ExternalLink, FileText, X } from "lucide-react";
import type { ReadableArticle } from "@/lib/feed-types";
import { useArticleExtraction } from "@/lib/use-article-extraction";
import { formatDate } from "@/lib/utils";
import { ArticleContent } from "./ArticleContent";
import { LocalSummary } from "./LocalSummary";
import { StatusMessage } from "./StatusMessage";

type ReaderViewProps = {
  article: ReadableArticle | null;
  onClose: () => void;
};

export function ReaderView({ article, onClose }: ReaderViewProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Open or close the native dialog when `article` changes.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (article && !dialog.open) dialog.showModal();
    if (!article && dialog.open) dialog.close();
  }, [article]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose} // fires for Escape key and dialog.close()
      aria-labelledby="reader-title"
      className="m-0 ml-auto h-dvh max-h-none w-full max-w-2xl border-l border-line bg-surface p-0 text-ink sm:rounded-l-2xl"
    >
      {article && (
        // `key` gives every article a fresh state (view mode, extraction).
        <ReaderBody key={article.id} article={article} onRequestClose={() => dialogRef.current?.close()} />
      )}
    </dialog>
  );
}

function ReaderBody({ article, onRequestClose }: { article: ReadableArticle; onRequestClose: () => void }) {
  const { state, retry } = useArticleExtraction(article.url);
  const [preferFeedText, setPreferFeedText] = useState(false);

  const extracted = state.status === "ready" ? state.article : undefined;
  const showFull = extracted !== undefined && !preferFeedText;
  const date = formatDate(article.publishedAt ?? extracted?.publishedTime);
  const author = article.author ?? extracted?.byline;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-6">
        <p className="truncate text-sm text-ink-muted">{article.feedTitle ?? extracted?.siteName ?? "Article"}</p>
        <button
          type="button"
          onClick={onRequestClose}
          className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-sm font-medium text-ink hover:bg-surface-muted"
        >
          <X aria-hidden="true" className="size-4" />
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <h2 id="reader-title" className="font-serif text-2xl leading-tight font-semibold sm:text-3xl">
          {article.title}
        </h2>
        <p className="mt-2 flex flex-wrap gap-x-2 text-sm text-ink-muted">
          {date && <time dateTime={article.publishedAt ?? extracted?.publishedTime}>{date}</time>}
          {author && <span>by {author}</span>}
          {extracted?.siteName && <span>· {extracted.siteName}</span>}
        </p>

        <div className="mt-4">
          {state.status === "loading" && <StatusMessage kind="loading" message="Loading the full article…" />}
          {state.status === "failed" && (
            <StatusMessage
              kind="info"
              message={`Full article unavailable: ${state.message} Showing the text from the feed instead.`}
              action={state.retryable ? { label: "Try again", onClick: retry } : undefined}
            />
          )}
          {extracted && (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Choose article version">
              <ViewToggle pressed={showFull} onClick={() => setPreferFeedText(false)} icon={<BookOpen aria-hidden="true" className="size-4" />}>
                Full article
              </ViewToggle>
              <ViewToggle pressed={!showFull} onClick={() => setPreferFeedText(true)} icon={<FileText aria-hidden="true" className="size-4" />}>
                Feed text
              </ViewToggle>
            </div>
          )}
        </div>

        {/* Stage 7: summarizes whichever version is on screen, entirely on this device. */}
        <LocalSummary
          content={showFull && extracted ? extracted.contentHtml : (article.contentHtml ?? article.summary)}
          isHtml={showFull && extracted ? true : Boolean(article.contentHtml)}
        />

        {showFull && extracted ? (
          <div lang={extracted.lang}>
            <ArticleContent html={extracted.contentHtml} baseUrl={extracted.pageUrl} />
          </div>
        ) : (
          <FeedText article={article} />
        )}

        <div className="mt-8 border-t border-line pt-4 text-sm text-ink-muted">
          {showFull && extracted ? (
            <p>
              Reading view made from the original page. Ads, menus and scripts were removed, and images and embedded
              media are not shown.
              {state.status === "ready" && state.source === "stored" && " Stored on this device for offline reading."}
              {state.status === "ready" && state.storageWarning && ` It could not be stored offline: ${state.storageWarning}`}
            </p>
          ) : (
            <p>
              This view shows the content included in the feed. It may be shorter than the original article.
              {!article.contentHtml && " This feed provided plain text only, so links from the original page are not shown."}
            </p>
          )}
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 font-medium text-accent underline-offset-4 hover:underline"
          >
            Read the original article
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        </div>
      </div>
    </div>
  );
}

/** The feed's own content: sanitized HTML when available, otherwise plain text. */
function FeedText({ article }: { article: ReadableArticle }) {
  if (article.contentHtml) return <ArticleContent html={article.contentHtml} baseUrl={article.url} />;
  if (article.summary) {
    // whitespace-pre-line keeps the paragraph breaks from htmlToText().
    return <div className="mt-6 font-serif text-lg leading-8 whitespace-pre-line">{article.summary}</div>;
  }
  return <p className="mt-6 text-ink-muted">This feed did not include any text for this article.</p>;
}

function ViewToggle({
  pressed,
  onClick,
  icon,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium ${
        pressed ? "border-accent bg-accent-soft text-ink" : "border-line text-ink hover:border-accent hover:text-accent"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
