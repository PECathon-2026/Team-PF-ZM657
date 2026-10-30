"use client";
// AI Word Meaning & Contextual Dictionary Assistant.
// Can be used as a header popover ("Word AI") or embedded inside ReaderView
// (where selecting any word in the article lets you explain it in context and save it to Notes).

import { useEffect, useState, type FormEvent } from "react";
import { BookA, BookmarkPlus, Check, LoaderCircle, Search, Volume2, X } from "lucide-react";
import type { WordExplanation } from "@/app/api/define/route";
import { saveNote } from "@/lib/db";
import { lookupWordMeaning } from "@/lib/define-client";
import { getLanguageName } from "@/lib/languages";
import { useLanguagePreferences } from "./LanguagePreferences";

type WordAssistantBoxProps = {
  initialWord?: string;
  contextSentence?: string;
  autoLookup?: boolean;
  articleUrl?: string;
  articleTitle?: string;
  onSavedToNotes?: () => void;
  onClose?: () => void;
};

export function WordAssistantBox({
  initialWord = "",
  contextSentence,
  autoLookup = false,
  articleUrl,
  articleTitle,
  onSavedToNotes,
  onClose,
}: WordAssistantBoxProps) {
  const { primaryLanguage } = useLanguagePreferences();
  const [query, setQuery] = useState(initialWord);
  const [loading, setLoading] = useState(Boolean(autoLookup && initialWord.trim()));
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WordExplanation | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    const trimmed = initialWord.trim();
    if (!autoLookup || !trimmed) return;
    const controller = new AbortController();
    lookupWordMeaning(trimmed, {
      contextSentence,
      targetLang: primaryLanguage,
      signal: controller.signal,
    }).then((res) => {
      if (controller.signal.aborted) return;
      setLoading(false);
      if (res.ok) {
        setResult(res.explanation);
      } else {
        setError(res.message);
      }
    });
    return () => controller.abort();
  }, [autoLookup, initialWord, contextSentence, primaryLanguage]);

  async function runLookup(wordToFind: string, sentence?: string) {
    const trimmed = wordToFind.trim();
    if (!trimmed) return;
    setQuery(trimmed);
    setLoading(true);
    setError(null);
    setSavedNotice(false);

    const res = await lookupWordMeaning(trimmed, {
      contextSentence: sentence,
      targetLang: primaryLanguage,
    });
    setLoading(false);

    if (!res.ok) {
      setError(res.message);
      setResult(null);
      return;
    }
    setResult(res.explanation);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void runLookup(query, query.trim().toLowerCase() === initialWord.trim().toLowerCase() ? contextSentence : undefined);
  }

  function pronounceWord(word: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(word);
      window.speechSynthesis.speak(utterance);
    } catch {
      // ignore speech synthesis errors
    }
  }

  async function handleSaveWordNote() {
    if (!result) return;
    const lines = [
      `Meaning: ${result.meaning}`,
      result.partOfSpeech ? `Part of speech: ${result.partOfSpeech}${result.phonetic ? ` (${result.phonetic})` : ""}` : "",
      result.inContext ? `In context: ${result.inContext}` : "",
      result.example ? `Example: "${result.example}"` : "",
      result.synonyms.length > 0 ? `Synonyms: ${result.synonyms.join(", ")}` : "",
    ].filter(Boolean);

    try {
      await saveNote({
        title: `Word: ${result.word}`,
        content: lines.join("\n"),
        articleUrl,
        articleTitle,
      });
      setSavedNotice(true);
      onSavedToNotes?.();
    } catch {
      setError("Could not save word to local notes.");
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-ink">
            <BookA aria-hidden="true" className="size-4 text-accent" />
            Word Meaning Assistant
          </h3>
          <p className="mt-0.5 text-xs text-ink-muted">
            Type any word or phrase (or highlight text in an article) for an instant explanation in{" "}
            <span className="font-medium text-ink">{getLanguageName(primaryLanguage)}</span>.
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close word assistant"
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl text-ink-muted hover:bg-surface-muted hover:text-ink"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
        <label htmlFor="word-lookup-input" className="sr-only">
          Word or phrase to explain
        </label>
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
          />
          <input
            id="word-lookup-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a word (e.g. ephemeral, serendipity)…"
            className="min-h-11 w-full rounded-xl border border-line bg-bg py-2 pr-3 pl-9 text-sm text-ink placeholder:text-ink-muted/70 focus:border-accent"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink hover:bg-accent-strong disabled:opacity-50"
        >
          {loading ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
          {loading ? "Explaining…" : "Explain"}
        </button>
      </form>

      {error && <p className="mt-2.5 text-xs font-medium text-danger">{error}</p>}

      {result && (
        <div className="mt-3.5 space-y-2 border-t border-line pt-3 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-serif text-lg font-bold text-ink">{result.word}</span>
              {result.phonetic && <span className="font-mono text-xs text-ink-muted">{result.phonetic}</span>}
              {result.partOfSpeech && <span className="text-xs italic text-accent">{result.partOfSpeech}</span>}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => pronounceWord(result.word)}
                aria-label={`Pronounce ${result.word}`}
                title="Listen to pronunciation"
                className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-line bg-bg px-2 text-ink hover:border-accent hover:text-accent"
              >
                <Volume2 aria-hidden="true" className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void handleSaveWordNote()}
                disabled={savedNotice}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-bg px-2.5 text-xs font-medium text-ink hover:border-accent hover:text-accent disabled:opacity-70"
              >
                {savedNotice ? (
                  <>
                    <Check aria-hidden="true" className="size-3.5 text-accent" />
                    Saved to Notes
                  </>
                ) : (
                  <>
                    <BookmarkPlus aria-hidden="true" className="size-3.5 text-accent" />
                    Save to Notes
                  </>
                )}
              </button>
            </div>
          </div>

          <p className="leading-relaxed text-ink">{result.meaning}</p>

          {result.inContext && (
            <p className="rounded-xl bg-accent-soft/60 p-2.5 text-xs leading-relaxed text-ink">
              <span className="font-semibold">In this sentence: </span>
              {result.inContext}
            </p>
          )}

          {result.example && (
            <p className="text-xs italic text-ink-muted">“{result.example}”</p>
          )}

          {result.synonyms.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
              <span className="text-ink-muted">Related:</span>
              {result.synonyms.map((syn) => (
                <button
                  key={syn}
                  type="button"
                  onClick={() => void runLookup(syn)}
                  className="rounded-md border border-line bg-bg px-2 py-0.5 text-ink hover:border-accent hover:text-accent"
                >
                  {syn}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Header button that toggles a floating Word Meaning Assistant popover anywhere on the page. */
export function WordAssistantHeaderButton({ onSavedToNotes }: { onSavedToNotes?: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label="Open AI Word Meaning Assistant"
        className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
          open
            ? "border-accent bg-accent-soft text-ink"
            : "border-line bg-surface text-ink hover:border-accent hover:text-accent"
        }`}
      >
        <BookA aria-hidden="true" className="size-4 text-accent" />
        <span className="hidden sm:inline">Word AI</span>
      </button>

      {open && (
        <div className="fixed inset-x-4 bottom-4 z-40 sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:bottom-auto sm:mt-2 sm:w-96">
          <WordAssistantBox onSavedToNotes={onSavedToNotes} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
