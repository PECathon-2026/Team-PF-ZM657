"use client";
// The readable view: a calm, full-height panel showing one article.
// Runs in the BROWSER.
//
// It uses the browser's built-in <dialog> element, which gives us keyboard
// support for free: focus moves into the dialog, and Escape closes it.
//
// Content: if the feed sent HTML (contentHtml), we show it sanitized, with
// working links. Otherwise we show the plain-text summary.
// Limitation: we only show what the FEED provides. If a feed has just a short
// plain summary, links that exist only on the original page are not available
// here. Fetching the full page (Readability) is planned for a later version.

import { useEffect, useRef } from "react";
import { ExternalLink, X } from "lucide-react";
import type { ReadableArticle } from "@/lib/feed-types";
import { ArticleContent } from "./ArticleContent";
import { formatDate } from "@/lib/utils";

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

  const date = article ? formatDate(article.publishedAt) : undefined;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose} // fires for Escape key and dialog.close()
      aria-labelledby="reader-title"
      className="m-0 ml-auto h-dvh max-h-none w-full max-w-2xl border-l border-line bg-surface p-0 text-ink sm:rounded-l-2xl"
    >
      {article && (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-6">
            <p className="truncate text-sm text-ink-muted">{article.feedTitle ?? "Article"}</p>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
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
              {date && <time dateTime={article.publishedAt}>{date}</time>}
              {article.author && <span>by {article.author}</span>}
            </p>

            {article.contentHtml ? (
              <ArticleContent html={article.contentHtml} baseUrl={article.url} />
            ) : article.summary ? (
              // whitespace-pre-line keeps the paragraph breaks from htmlToText().
              <div className="mt-6 font-serif text-lg leading-8 whitespace-pre-line">{article.summary}</div>
            ) : (
              <p className="mt-6 text-ink-muted">This feed did not include any text for this article.</p>
            )}

            <p className="mt-8 border-t border-line pt-4 text-sm text-ink-muted">
              This view shows the content included in the feed. It may be shorter than the original article.
              {!article.contentHtml && " This feed provided plain text only, so links from the original page are not shown."}
            </p>
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
      )}
    </dialog>
  );
}
