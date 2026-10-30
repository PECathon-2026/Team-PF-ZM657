"use client";
// One article in a list: title, date, author, short summary, translation option, and actions.
// Runs in the BROWSER (rendered inside the client page).
//
// Safety: every value from the feed is rendered as plain text by React.
// We never use dangerouslySetInnerHTML. Remote images are not loaded,
// so blogs cannot track who is reading the list.

import { useState } from "react";
import { Bookmark, BookmarkCheck, BookOpen, ExternalLink, Languages, LoaderCircle } from "lucide-react";
import type { ReadableArticle } from "@/lib/feed-types";
import { detectContentLanguage, getLanguageName, needsTranslation } from "@/lib/languages";
import { translateText } from "@/lib/translate-client";
import { formatDate } from "@/lib/utils";
import { useLanguagePreferences } from "./LanguagePreferences";

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

  const { preferredLanguages, primaryLanguage } = useLanguagePreferences();
  const [targetLang, setTargetLang] = useState<string>(primaryLanguage);
  const [translation, setTranslation] = useState<{ title: string; summary: string; lang: string } | null>(null);
  const [showTranslated, setShowTranslated] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  const detectedLang = detectContentLanguage(`${article.title} ${article.summary}`);
  const foreignToUser = needsTranslation(detectedLang, preferredLanguages);
  const activeTargetLang = preferredLanguages.includes(targetLang) ? targetLang : primaryLanguage;

  async function handleTranslate(langCode: string) {
    if (translation && translation.lang === langCode) {
      setShowTranslated((prev) => !prev);
      return;
    }
    setIsTranslating(true);
    setTranslateError(null);

    const [titleRes, summaryRes] = await Promise.all([
      translateText(article.title, langCode, { sourceLang: detectedLang }),
      article.summary
        ? translateText(article.summary, langCode, { sourceLang: detectedLang })
        : Promise.resolve({ ok: true as const, translatedText: "" }),
    ]);

    setIsTranslating(false);
    if (!titleRes.ok) {
      setTranslateError(titleRes.message);
      return;
    }
    setTranslation({
      title: titleRes.translatedText,
      summary: summaryRes.ok ? summaryRes.translatedText : article.summary,
      lang: langCode,
    });
    setShowTranslated(true);
  }

  const displayedTitle = showTranslated && translation ? translation.title : article.title;
  const displayedSummary = showTranslated && translation ? translation.summary : article.summary;

  return (
    <article
      aria-labelledby={headingId}
      className="rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-accent/50 sm:p-5"
    >
      <h3
        id={headingId}
        className={`font-serif font-semibold leading-snug text-ink ${compact ? "text-base" : "text-xl"}`}
      >
        {displayedTitle}
      </h3>

      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-muted sm:text-sm">
        {compact && article.feedTitle && <span>{article.feedTitle}</span>}
        {compact && article.feedTitle && (date || article.author) && <span aria-hidden="true">·</span>}
        {date && <time dateTime={article.publishedAt}>{date}</time>}
        {date && article.author && <span aria-hidden="true">·</span>}
        {article.author && <span>by {article.author}</span>}
        {foreignToUser && detectedLang && (
          <>
            {(date || article.author || (compact && article.feedTitle)) && <span aria-hidden="true">·</span>}
            <span>{getLanguageName(detectedLang)}</span>
          </>
        )}
      </p>

      {!compact && displayedSummary && (
        <p className="mt-2.5 line-clamp-3 text-[0.95rem] leading-relaxed text-ink/90">{displayedSummary}</p>
      )}

      {translateError && <p className="mt-2 text-xs text-danger">{translateError}</p>}

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onRead(article)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-bg px-3.5 text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent whitespace-nowrap"
        >
          <BookOpen aria-hidden="true" className="size-4 text-accent" />
          Read<span className="sr-only">: {article.title}</span>
        </button>

        <button
          type="button"
          onClick={() => onToggleSave(article)}
          aria-pressed={isSaved}
          className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3.5 text-sm font-medium transition-colors whitespace-nowrap ${
            isSaved
              ? "border-accent bg-accent-soft text-ink"
              : "border-line bg-bg text-ink hover:border-accent hover:text-accent"
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

        {foreignToUser && (
          <div className="inline-flex items-center gap-1">
            {preferredLanguages.length > 1 && !showTranslated && (
              <select
                aria-label="Target language for translation"
                value={activeTargetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className="min-h-11 rounded-xl border border-line bg-bg px-2.5 text-xs font-medium text-ink"
              >
                {preferredLanguages.map((code) => (
                  <option key={code} value={code}>
                    {getLanguageName(code)}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              disabled={isTranslating}
              onClick={() => void handleTranslate(activeTargetLang)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-accent/50 bg-accent-soft px-3.5 text-sm font-medium text-ink transition-colors hover:border-accent disabled:opacity-60 whitespace-nowrap"
            >
              {isTranslating ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-accent" />
              ) : (
                <Languages aria-hidden="true" className="size-4 text-accent" />
              )}
              {isTranslating
                ? "Translating…"
                : showTranslated
                  ? "Show original"
                  : `Translate to ${getLanguageName(activeTargetLang)}`}
            </button>
          </div>
        )}

        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2.5 text-sm font-medium text-accent underline-offset-4 hover:underline whitespace-nowrap"
        >
          Original
          <ExternalLink aria-hidden="true" className="size-3.5" />
          <span className="sr-only">(opens {article.title} in a new tab)</span>
        </a>
      </div>
    </article>
  );
}
