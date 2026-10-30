"use client";
// "Summarize locally" & localized summary box inside the reading view.
// Supports both the Stage 7 Web Worker neural T5 model AND instant on-device
// extractive summarization + one-tap localization into the user's preferred language.

import { useState } from "react";
import { Languages, LoaderCircle, Sparkles, Square } from "lucide-react";
import { LOCAL_AI_MODEL } from "@/lib/ai/config";
import { buildExtractiveSummary } from "@/lib/extractive-summary";
import { detectContentLanguage, getLanguageName, needsTranslation } from "@/lib/languages";
import { translateText } from "@/lib/translate-client";
import { useLanguagePreferences } from "./LanguagePreferences";
import { useLocalAi } from "./LocalAiProvider";

type SummaryState =
  | { kind: "idle" }
  | { kind: "working"; tokens: number }
  | { kind: "done"; text: string; truncated: boolean; mode: "neural" | "extractive"; translatedText?: string; translatedLang?: string }
  | { kind: "failed"; message: string };

type LocalSummaryProps = {
  content: string; // the article text currently shown
  isHtml: boolean;
};

export function LocalSummary({ content, isHtml }: LocalSummaryProps) {
  const ai = useLocalAi();
  const { preferredLanguages, primaryLanguage } = useLanguagePreferences();
  const [state, setState] = useState<SummaryState>({ kind: "idle" });
  const [isTranslatingSummary, setIsTranslatingSummary] = useState(false);

  // When rendered outside LocalAiProvider (e.g. standalone ReaderView tests), stay hidden.
  if (
    ai.status.phase === "checking" ||
    (ai.status.phase === "unsupported" && ai.status.reason === "Local AI is not available here.")
  ) {
    return null;
  }

  function runQuickExtractiveSummary() {
    const result = buildExtractiveSummary(content, isHtml, 3);
    if (!result.ok) {
      setState({ kind: "failed", message: result.message });
      return;
    }
    setState({ kind: "done", text: result.text, truncated: result.truncated, mode: "extractive" });
  }

  async function localizeSummary(summaryText: string, targetLang: string) {
    setIsTranslatingSummary(true);
    const res = await translateText(summaryText, targetLang, { isHtml: false });
    setIsTranslatingSummary(false);
    if (res.ok) {
      setState((prev) =>
        prev.kind === "done"
          ? { ...prev, translatedText: res.translatedText, translatedLang: targetLang }
          : prev,
      );
    }
  }

  // When neural Local AI is not yet downloaded/ready (or unsupported on mobile browser),
  // keep the exact guidance message AND provide an instant on-device extractive summary button!
  if (ai.status.phase !== "ready" && state.kind !== "working") {
    return (
      <section aria-labelledby="local-summary-fallback-title" className="mt-4 rounded-xl border border-line bg-surface-muted/60 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="local-summary-fallback-title" className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Sparkles aria-hidden="true" className="size-4 text-accent" />
            Local summary
          </h3>
          <button
            type="button"
            onClick={runQuickExtractiveSummary}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
          >
            Instant summary
          </button>
        </div>

        <p className="mt-2 text-sm text-ink-muted">
          {state.kind === "failed" && <span className="mb-1 block text-ink">{state.message}</span>}
          {ai.status.phase === "unsupported" ? (
            <span>Neural AI is unavailable in this browser; use Instant summary for an on-device key-sentence overview.</span>
          ) : (
            <>
              Turn on <span className="font-medium text-ink">Local AI</span> in the side panel to summarize articles on this device.
            </>
          )}
        </p>

        {state.kind === "done" && (
          <div className="mt-3 border-t border-line pt-3">
            <p className="font-serif text-base leading-7 text-ink">
              {state.translatedText ?? state.text}
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-ink-muted">
                Extracted on this device from key article sentences.
                {state.translatedLang ? ` Translated to ${getLanguageName(state.translatedLang)}.` : ""}
              </p>
              {!state.translatedText ? (
                <button
                  type="button"
                  disabled={isTranslatingSummary}
                  onClick={() => void localizeSummary(state.text, primaryLanguage)}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-xs font-medium text-ink hover:border-accent hover:text-accent disabled:opacity-60"
                >
                  <Languages aria-hidden="true" className="size-3.5 text-accent" />
                  {isTranslatingSummary ? "Translating…" : `Localize to ${getLanguageName(primaryLanguage)}`}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setState({ ...state, translatedText: undefined, translatedLang: undefined })}
                  className="inline-flex min-h-9 items-center rounded-lg border border-line bg-surface px-2.5 text-xs font-medium text-ink hover:border-accent"
                >
                  Show original summary
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    );
  }

  async function run() {
    setState({ kind: "working", tokens: 0 });
    const result = await ai.summarize(content, isHtml, (tokens) => setState({ kind: "working", tokens }));
    if (result.ok) {
      setState({ kind: "done", text: result.text, truncated: result.truncated, mode: "neural" });
      const detected = detectContentLanguage(result.text);
      if (needsTranslation(detected, preferredLanguages)) {
        void localizeSummary(result.text, primaryLanguage);
      }
    } else {
      setState({ kind: "failed", message: result.message });
    }
  }

  return (
    <section aria-labelledby="local-summary-title" className="mt-4 rounded-xl border border-line bg-surface-muted/60 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="local-summary-title" className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Sparkles aria-hidden="true" className="size-4 text-accent" />
          Local summary
        </h3>
        {state.kind === "working" ? (
          <button
            type="button"
            onClick={ai.cancel}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium text-ink hover:border-danger hover:text-danger"
          >
            <Square aria-hidden="true" className="size-3.5" /> Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void run()}
            disabled={ai.status.phase === "ready" && ai.status.busy}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-semibold text-accent-ink hover:bg-accent-strong disabled:opacity-60"
          >
            {state.kind === "done" ? "Summarize again" : "Summarize locally"}
          </button>
        )}
      </div>

      <div aria-live="polite" className="mt-2 text-sm">
        {state.kind === "working" && (
          <p className="flex items-center gap-2 text-ink">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-accent" />
            {state.tokens === 0
              ? "Reading the article on this device…"
              : `Writing summary… ${Math.min(100, Math.round((state.tokens / LOCAL_AI_MODEL.maxNewTokens) * 100))}%`}
          </p>
        )}
        {state.kind === "failed" && <p className="text-ink">{state.message}</p>}
        {state.kind === "done" && (
          <>
            <p className="font-serif text-base leading-7 text-ink">{state.translatedText ?? state.text}</p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-ink-muted">
                Made on this device by a small AI model. It may be incomplete or wrong — check the article.
                {state.truncated && " Only the beginning of a long article was summarized."}
                {state.translatedLang && ` Localized into ${getLanguageName(state.translatedLang)}.`}
              </p>
              {!state.translatedText ? (
                <button
                  type="button"
                  disabled={isTranslatingSummary}
                  onClick={() => void localizeSummary(state.text, primaryLanguage)}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-xs font-medium text-ink hover:border-accent hover:text-accent disabled:opacity-60"
                >
                  <Languages aria-hidden="true" className="size-3.5 text-accent" />
                  {isTranslatingSummary ? "Translating…" : `Translate summary (${getLanguageName(primaryLanguage)})`}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setState({ ...state, translatedText: undefined, translatedLang: undefined })}
                  className="inline-flex min-h-9 items-center rounded-lg border border-line bg-surface px-2.5 text-xs font-medium text-ink hover:border-accent"
                >
                  Show original
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
