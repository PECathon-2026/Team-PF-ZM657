"use client";
// "Summarize locally" box inside the reading view (Stage 7). Runs in the BROWSER.
// The text is summarized by the local model in a Web Worker. The result is
// validated (lib/ai/text.ts) and shown as PLAIN TEXT — never as HTML.

import { useState } from "react";
import { LoaderCircle, Sparkles, Square } from "lucide-react";
import { LOCAL_AI_MODEL } from "@/lib/ai/config";
import { useLocalAi } from "./LocalAiProvider";

type SummaryState =
  | { kind: "idle" }
  | { kind: "working"; tokens: number }
  | { kind: "done"; text: string; truncated: boolean }
  | { kind: "failed"; message: string };

type LocalSummaryProps = {
  content: string; // the article text currently shown
  isHtml: boolean;
};

export function LocalSummary({ content, isHtml }: LocalSummaryProps) {
  const ai = useLocalAi();
  const [state, setState] = useState<SummaryState>({ kind: "idle" });

  if (ai.status.phase === "checking" || ai.status.phase === "unsupported") return null;

  if (ai.status.phase !== "ready" && state.kind !== "working") {
    return (
      <p className="mt-4 rounded-lg bg-surface-muted p-3 text-sm text-ink-muted">
        {state.kind === "failed" && <span className="block text-ink">{state.message}</span>}
        Turn on <span className="font-medium text-ink">Local AI</span> in the side panel to summarize articles on this device.
      </p>
    );
  }

  async function run() {
    setState({ kind: "working", tokens: 0 });
    const result = await ai.summarize(content, isHtml, (tokens) => setState({ kind: "working", tokens }));
    setState(result.ok ? { kind: "done", text: result.text, truncated: result.truncated } : { kind: "failed", message: result.message });
  }

  return (
    <section aria-labelledby="local-summary-title" className="mt-4 rounded-xl border border-line bg-surface-muted/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="local-summary-title" className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Sparkles aria-hidden="true" className="size-4 text-accent" />
          Local summary
        </h3>
        {state.kind === "working" ? (
          <button
            type="button"
            onClick={ai.cancel}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium text-ink hover:border-danger hover:text-danger"
          >
            <Square aria-hidden="true" className="size-3.5" /> Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void run()}
            disabled={ai.status.phase === "ready" && ai.status.busy}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-60 dark:text-bg"
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
            <p className="font-serif text-base leading-7 text-ink">{state.text}</p>
            <p className="mt-2 text-xs text-ink-muted">
              Made on this device by a small AI model. It may be incomplete or wrong — check the article.
              {state.truncated && " Only the beginning of a long article was summarized."}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
