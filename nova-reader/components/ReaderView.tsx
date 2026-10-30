"use client";
// The readable view: a calm, resizable panel showing one article.
// Runs in the BROWSER.
//
// Features:
//   - Native <dialog> element (keyboard focus trap + Escape support).
//   - Draggable resize handles:
//       * Desktop / tablet: drag the left edge horizontally (or use ArrowLeft/ArrowRight)
//         to widen or narrow the reading window (380px up to 96vw).
//       * Mobile (< 640px): drag the top grab bar vertically to expand or shrink height.
//   - Full-article translation into the user's preferred language(s) when an article
//     is in another language (or on demand), sanitized via DOMPurify.

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  BookA,
  BookOpen,
  ExternalLink,
  FileText,
  GripHorizontal,
  GripVertical,
  Languages,
  LoaderCircle,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import type { ReadableArticle } from "@/lib/feed-types";
import { detectContentLanguage, getLanguageName, needsTranslation, SUPPORTED_LANGUAGES } from "@/lib/languages";
import { translateText } from "@/lib/translate-client";
import { useArticleExtraction } from "@/lib/use-article-extraction";
import { formatDate } from "@/lib/utils";
import { ArticleContent } from "./ArticleContent";
import { ArticleProvenanceLine } from "./BlockchainCompliance";
import { FontSizeControl } from "./FontSizeProvider";
import { useLanguagePreferences } from "./LanguagePreferences";
import { LocalSummary } from "./LocalSummary";
import { ArticleNotesPad } from "./NotesWorkspace";
import { StatusMessage } from "./StatusMessage";
import { WordAssistantBox } from "./WordAssistant";

type ReaderViewProps = {
  article: ReadableArticle | null;
  onClose: () => void;
  onNotesChanged?: () => void;
};

const WIDTH_STORAGE_KEY = "nova-reader-width-px";
const DEFAULT_WIDTH_PX = 720;
const MIN_WIDTH_PX = 380;

function subscribeMobileViewport(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia("(max-width: 639px)");
  mq.addEventListener?.("change", onChange);
  return () => mq.removeEventListener?.("change", onChange);
}

function getMobileViewportSnapshot(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(max-width: 639px)").matches;
}

function readStoredWidthSnapshot(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH_PX;
  try {
    const saved = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY));
    if (Number.isFinite(saved) && saved >= MIN_WIDTH_PX) return saved;
  } catch {
    // ignore storage errors
  }
  return DEFAULT_WIDTH_PX;
}

const noopSubscribe = () => () => {};

export function ReaderView({ article, onClose, onNotesChanged }: ReaderViewProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const storedInitialWidth = useSyncExternalStore(noopSubscribe, readStoredWidthSnapshot, () => DEFAULT_WIDTH_PX);
  const [customWidthPx, setCustomWidthPx] = useState<number | null>(null);
  const widthPx = customWidthPx ?? storedInitialWidth;
  const setWidthPx = (next: number | ((current: number) => number)) => {
    setCustomWidthPx((prev) => {
      const current = prev ?? storedInitialWidth;
      return typeof next === "function" ? next(current) : next;
    });
  };
  const [mobileHeightVh, setMobileHeightVh] = useState<number>(92);
  const isMobileViewport = useSyncExternalStore(subscribeMobileViewport, getMobileViewportSnapshot, () => false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Open or close the native dialog when `article` changes.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (article && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    if (!article && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [article]);

  function clampWidth(target: number): number {
    const maxAllowed = typeof window !== "undefined" ? Math.max(MIN_WIDTH_PX, Math.round(window.innerWidth * 0.96)) : 1280;
    return Math.min(maxAllowed, Math.max(MIN_WIDTH_PX, Math.round(target)));
  }

  function persistWidth(next: number) {
    try {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(next));
    } catch {
      // ignore
    }
  }

  function handleHorizontalDragStart(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    setIsDragging(true);

    const onMove = (moveEvent: PointerEvent) => {
      const desired = window.innerWidth - moveEvent.clientX;
      setWidthPx(clampWidth(desired));
    };

    const onEnd = () => {
      setIsDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      setWidthPx((current) => {
        persistWidth(current);
        return current;
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  }

  function handleVerticalMobileDragStart(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    setIsDragging(true);

    const onMove = (moveEvent: PointerEvent) => {
      const pct = ((window.innerHeight - moveEvent.clientY) / window.innerHeight) * 100;
      setMobileHeightVh(Math.min(100, Math.max(50, Math.round(pct))));
    };

    const onEnd = () => {
      setIsDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  }

  function handleResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      const next = clampWidth(widthPx + 48);
      setWidthPx(next);
      persistWidth(next);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      const next = clampWidth(widthPx - 48);
      setWidthPx(next);
      persistWidth(next);
    } else if (event.key === "Home") {
      event.preventDefault();
      const next = clampWidth(1400);
      setWidthPx(next);
      persistWidth(next);
    } else if (event.key === "End") {
      event.preventDefault();
      setWidthPx(DEFAULT_WIDTH_PX);
      persistWidth(DEFAULT_WIDTH_PX);
    }
  }

  function togglePresetWidth() {
    const wide = typeof window !== "undefined" ? clampWidth(Math.round(window.innerWidth * 0.85)) : 1080;
    const isCurrentlyWide = widthPx > DEFAULT_WIDTH_PX + 100;
    const next = isCurrentlyWide ? DEFAULT_WIDTH_PX : wide;
    setWidthPx(next);
    persistWidth(next);
  }

  const maxWidthPx =
    typeof window !== "undefined" ? Math.max(MIN_WIDTH_PX + 100, Math.round(window.innerWidth * 0.96)) : 1600;
  const clampedNowWidth = Math.min(maxWidthPx, Math.max(MIN_WIDTH_PX, widthPx));

  const dialogStyle = isMobileViewport
    ? { height: `${mobileHeightVh}dvh`, width: "100%", maxWidth: "100%" }
    : { width: `${clampedNowWidth}px`, maxWidth: "96vw" };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose} // fires for Escape key and dialog.close()
      aria-labelledby="reader-title"
      style={dialogStyle}
      className={`m-0 mt-auto ml-auto max-h-none border-t border-line bg-surface p-0 text-ink shadow-2xl sm:mt-0 sm:h-dvh sm:rounded-l-2xl sm:border-t-0 sm:border-l ${
        isDragging ? "select-none" : ""
      } max-sm:rounded-t-2xl`}
    >
      {article && (
        <div className="relative flex h-full flex-col sm:flex-row">
          {/* Desktop / Tablet left-edge drag resize handle */}
          <div
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label="Drag left or right to resize reading window"
            aria-valuemin={MIN_WIDTH_PX}
            aria-valuemax={maxWidthPx}
            aria-valuenow={clampedNowWidth}
            onPointerDown={handleHorizontalDragStart}
            onDoubleClick={() => {
              setWidthPx(DEFAULT_WIDTH_PX);
              persistWidth(DEFAULT_WIDTH_PX);
            }}
            onKeyDown={handleResizeKeyDown}
            title="Drag to resize reading window (double-click to reset)"
            className="group hidden w-3.5 shrink-0 cursor-ew-resize touch-none items-center justify-center border-r border-line/60 bg-surface-muted/40 transition-colors hover:bg-accent-soft sm:flex"
          >
            <GripVertical aria-hidden="true" className="size-3.5 text-ink-muted group-hover:text-accent" />
          </div>

          {/* Mobile top-edge drag resize bar */}
          <div
            role="separator"
            tabIndex={0}
            aria-orientation="horizontal"
            aria-label="Drag up or down to resize reading sheet"
            aria-valuemin={50}
            aria-valuemax={100}
            aria-valuenow={mobileHeightVh}
            onPointerDown={handleVerticalMobileDragStart}
            className="flex h-8 shrink-0 cursor-ns-resize touch-none items-center justify-center border-b border-line/60 bg-surface-muted/40 sm:hidden"
          >
            <GripHorizontal aria-hidden="true" className="size-4 text-ink-muted" />
          </div>

          {/* `key` gives every article a fresh state (view mode, extraction, translation). */}
          <ReaderBody
            key={article.id}
            article={article}
            isWide={widthPx > DEFAULT_WIDTH_PX + 100}
            onTogglePresetWidth={togglePresetWidth}
            onNotesChanged={onNotesChanged}
            onRequestClose={() => dialogRef.current?.close()}
          />
        </div>
      )}
    </dialog>
  );
}

function ReaderBody({
  article,
  isWide,
  onTogglePresetWidth,
  onNotesChanged,
  onRequestClose,
}: {
  article: ReadableArticle;
  isWide: boolean;
  onTogglePresetWidth: () => void;
  onNotesChanged?: () => void;
  onRequestClose: () => void;
}) {
  const { state, retry } = useArticleExtraction(article.url);
  const [preferFeedText, setPreferFeedText] = useState(false);
  const [wordToolOpen, setWordToolOpen] = useState(false);
  const [selectedWordInfo, setSelectedWordInfo] = useState<{ word: string; sentence?: string; auto: boolean }>({
    word: "",
    auto: false,
  });

  const { preferredLanguages, primaryLanguage } = useLanguagePreferences();
  const [targetLang, setTargetLang] = useState<string>(primaryLanguage);
  const [translatedData, setTranslatedData] = useState<{
    title: string;
    body: string;
    isHtml: boolean;
    lang: string;
  } | null>(null);
  const [showTranslated, setShowTranslated] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  const extracted = state.status === "ready" ? state.article : undefined;
  const showFull = extracted !== undefined && !preferFeedText;
  const date = formatDate(article.publishedAt ?? extracted?.publishedTime);
  const author = article.author ?? extracted?.byline;

  const activeSourceBody = showFull && extracted ? extracted.contentHtml : (article.contentHtml ?? article.summary);
  const activeIsHtml = showFull && extracted ? true : Boolean(article.contentHtml);

  const detectedLang = detectContentLanguage(
    `${article.title} ${extracted?.excerpt ?? article.summary}`,
    extracted?.lang,
  );
  const foreignToUser = needsTranslation(detectedLang, preferredLanguages);
  const chosenTarget = SUPPORTED_LANGUAGES.some((l) => l.code === targetLang) ? targetLang : primaryLanguage;

  async function handleTranslateArticle(langCode: string) {
    if (translatedData && translatedData.lang === langCode && translatedData.isHtml === activeIsHtml) {
      setShowTranslated((prev) => !prev);
      return;
    }
    setIsTranslating(true);
    setTranslateError(null);

    const [titleRes, bodyRes] = await Promise.all([
      translateText(article.title, langCode, { sourceLang: detectedLang }),
      activeSourceBody
        ? translateText(activeSourceBody, langCode, { isHtml: activeIsHtml, sourceLang: detectedLang })
        : Promise.resolve({ ok: true as const, translatedText: "" }),
    ]);

    setIsTranslating(false);
    if (!titleRes.ok || !bodyRes.ok) {
      setTranslateError(!titleRes.ok ? titleRes.message : !bodyRes.ok ? bodyRes.message : "Translation failed.");
      return;
    }

    setTranslatedData({
      title: titleRes.translatedText,
      body: bodyRes.translatedText,
      isHtml: activeIsHtml,
      lang: langCode,
    });
    setShowTranslated(true);
  }

  const displayedTitle = showTranslated && translatedData ? translatedData.title : article.title;

  function captureTextSelection() {
    if (typeof window === "undefined") return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const raw = selection.toString().trim().replace(/\s+/g, " ");
    const wordCount = raw.split(" ").filter(Boolean).length;
    if (!raw || raw.length > 60 || wordCount > 5) return;

    const anchorText = selection.anchorNode?.textContent ?? "";
    const sentence = anchorText.trim().slice(0, 320) || undefined;
    setSelectedWordInfo({ word: raw, sentence, auto: true });
    setWordToolOpen(true);
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-6">
        <p className="truncate text-sm font-medium text-ink-muted">
          {article.feedTitle ?? extracted?.siteName ?? "Article"}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <FontSizeControl compact />
          <button
            type="button"
            onClick={() => {
              setWordToolOpen((prev) => !prev);
              if (wordToolOpen) setSelectedWordInfo({ word: "", auto: false });
            }}
            aria-expanded={wordToolOpen}
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium ${
              wordToolOpen
                ? "border-accent bg-accent-soft text-ink"
                : "border-line text-ink hover:border-accent hover:text-accent"
            }`}
          >
            <BookA aria-hidden="true" className="size-3.5 text-accent" />
            <span>Explain word</span>
          </button>
          <button
            type="button"
            onClick={onTogglePresetWidth}
            aria-label={isWide ? "Restore standard reading width" : "Expand reading window width"}
            title={isWide ? "Standard width" : "Wide reading view"}
            className="hidden min-h-10 items-center gap-1.5 rounded-xl border border-line px-2.5 text-xs font-medium text-ink hover:border-accent hover:text-accent sm:inline-flex"
          >
            {isWide ? (
              <Minimize2 aria-hidden="true" className="size-3.5" />
            ) : (
              <Maximize2 aria-hidden="true" className="size-3.5" />
            )}
            <span>{isWide ? "Standard" : "Wide"}</span>
          </button>
          <button
            type="button"
            onClick={onRequestClose}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-ink hover:bg-surface-muted"
          >
            <X aria-hidden="true" className="size-4" />
            Close
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-3xl">
          <h2 id="reader-title" className="font-serif text-2xl leading-tight font-semibold sm:text-3xl">
            {displayedTitle}
          </h2>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-ink-muted">
            {date && <time dateTime={article.publishedAt ?? extracted?.publishedTime}>{date}</time>}
            {author && <span>by {author}</span>}
            {extracted?.siteName && <span>· {extracted.siteName}</span>}
            {detectedLang && <span>· {getLanguageName(detectedLang)}</span>}
          </p>
          <ArticleProvenanceLine article={article} />

          {/* Language translation banner when article is not in user's preferred language(s), plus on-demand selector */}
          <div
            className={`mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm ${
              foreignToUser ? "border-accent/50 bg-accent-soft/60" : "border-line bg-surface-muted/40"
            }`}
          >
            <div className="flex items-center gap-2 text-ink">
              <Languages aria-hidden="true" className="size-4 shrink-0 text-accent" />
              <span>
                {foreignToUser && detectedLang
                  ? `This article appears to be in ${getLanguageName(detectedLang)}.`
                  : "Translate this article into another language:"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!showTranslated && (
                <select
                  aria-label="Translate article to language"
                  value={chosenTarget}
                  onChange={(e) => setTargetLang(e.target.value)}
                  className="min-h-10 rounded-lg border border-line bg-surface px-2.5 text-xs font-medium text-ink"
                >
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.name} ({lang.nativeName})
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                disabled={isTranslating}
                onClick={() => void handleTranslateArticle(chosenTarget)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent-strong disabled:opacity-60 whitespace-nowrap"
              >
                {isTranslating && <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />}
                {isTranslating
                  ? "Translating…"
                  : showTranslated
                    ? "Show original"
                    : `Translate to ${getLanguageName(chosenTarget)}`}
              </button>
            </div>
          </div>

          {translateError && <p className="mt-2 text-sm text-danger">{translateError}</p>}

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
                <ViewToggle
                  pressed={showFull}
                  onClick={() => {
                    setPreferFeedText(false);
                    setShowTranslated(false);
                    setTranslatedData(null);
                  }}
                  icon={<BookOpen aria-hidden="true" className="size-4" />}
                >
                  Full article
                </ViewToggle>
                <ViewToggle
                  pressed={!showFull}
                  onClick={() => {
                    setPreferFeedText(true);
                    setShowTranslated(false);
                    setTranslatedData(null);
                  }}
                  icon={<FileText aria-hidden="true" className="size-4" />}
                >
                  Feed text
                </ViewToggle>
              </div>
            )}
          </div>

          {/* Stage 7: summarizes whichever version is on screen, entirely on this device. */}
          <LocalSummary content={activeSourceBody} isHtml={activeIsHtml} />

          {/* Per-article note-making pad */}
          <ArticleNotesPad
            articleUrl={article.url}
            articleTitle={article.title}
            onNotesChanged={onNotesChanged}
          />

          {/* AI Word Meaning Assistant (also opens automatically when double-clicking / highlighting 1-5 words in the article) */}
          {wordToolOpen && (
            <div className="mt-4">
              <WordAssistantBox
                key={`${selectedWordInfo.word}-${selectedWordInfo.auto ? "1" : "0"}`}
                initialWord={selectedWordInfo.word}
                contextSentence={selectedWordInfo.sentence}
                autoLookup={selectedWordInfo.auto}
                articleUrl={article.url}
                articleTitle={article.title}
                onSavedToNotes={onNotesChanged}
                onClose={() => setWordToolOpen(false)}
              />
            </div>
          )}

          {/* Double-click or highlight any word in the article below to explain its meaning */}
          <div onDoubleClick={captureTextSelection} onMouseUp={captureTextSelection}>
            {showTranslated && translatedData ? (
              <div lang={translatedData.lang}>
                {translatedData.isHtml ? (
                  <ArticleContent html={translatedData.body} baseUrl={extracted?.pageUrl ?? article.url} />
                ) : (
                  <div className="mt-6 font-serif text-lg leading-8 whitespace-pre-line">{translatedData.body}</div>
                )}
              </div>
            ) : showFull && extracted ? (
              <div lang={extracted.lang}>
                <ArticleContent html={extracted.contentHtml} baseUrl={extracted.pageUrl} />
              </div>
            ) : (
              <FeedText article={article} />
            )}
          </div>

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
              className="mt-2 inline-flex min-h-11 items-center gap-1.5 font-medium text-accent underline-offset-4 hover:underline"
            >
              Read the original article
              <ExternalLink aria-hidden="true" className="size-4" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The feed's own content: sanitized HTML when available, otherwise plain text. */
function FeedText({ article }: { article: ReadableArticle }) {
  if (article.contentHtml) return <ArticleContent html={article.contentHtml} baseUrl={article.url} />;
  if (article.summary) {
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
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3.5 text-sm font-medium ${
        pressed ? "border-accent bg-accent-soft text-ink" : "border-line text-ink hover:border-accent hover:text-accent"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
