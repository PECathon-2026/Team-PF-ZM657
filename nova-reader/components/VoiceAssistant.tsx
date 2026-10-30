"use client";
// Hands-free voice assistant for blind and low-vision readers.
// Trigger phrase: "Hey Nova" (also supports one-shot "Hey Nova <keyword>",
// clicking the Voice button, or pressing Alt+V).
// Workflow:
//   1. Wake phrase "Hey Nova" → prompts for an article keyword.
//   2. Keyword spoken → searches loaded feed items + saved/cached IndexedDB feeds.
//   3. Reads out matching blog headings one by one via speechSynthesis.
//   4. When the user says "Yes" (or "Open"), opens that article's URL in ReaderView
//      (and offers direct navigation). Saying "Next" / "No" reads the next match.

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { Mic, MicOff, Volume2, X } from "lucide-react";
import { getSavedArticles, listCachedFeeds } from "@/lib/db";
import type { ReadableArticle } from "@/lib/feed-types";

type VoicePhase =
  | "off"
  | "wake-standby" // listening for "hey nova"
  | "awaiting-keyword" // heard "hey nova", listening for search keyword
  | "speaking" // reading prompt or article heading aloud
  | "confirming"; // waiting for "yes" / "next" / "cancel"

type SpeechRecognitionAlternativeLike = { transcript: string };
type SpeechRecognitionResultLike = { isFinal: boolean; 0: SpeechRecognitionAlternativeLike };
type SpeechRecognitionEventLike = { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> };

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type VoiceAssistantProps = {
  currentArticles: ReadableArticle[];
  onOpenArticle: (article: ReadableArticle) => void;
};

const noopSubscribe = () => () => {};

export function VoiceAssistant({ currentArticles, onOpenArticle }: VoiceAssistantProps) {
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => Boolean(getSpeechRecognitionCtor()),
    () => false,
  );
  const [phase, setPhase] = useState<VoicePhase>("off");
  const [panelOpen, setPanelOpen] = useState(false);
  const [announcement, setAnnouncement] = useState<string>(
    "Say “Hey Nova” when voice mode is active, or press Alt+V to search articles by voice.",
  );
  const [lastHeard, setLastHeard] = useState<string>("");
  const [matches, setMatches] = useState<ReadableArticle[]>([]);
  const [matchIndex, setMatchIndex] = useState(0);
  const [manualInput, setManualInput] = useState("");

  const phaseRef = useRef<VoicePhase>("off");
  const matchesRef = useRef<ReadableArticle[]>([]);
  const matchIndexRef = useRef(0);
  const articlesRef = useRef<ReadableArticle[]>(currentArticles);
  const onOpenRef = useRef(onOpenArticle);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const shouldKeepListeningRef = useRef(false);
  const isSpeakingRef = useRef(false);

  useEffect(() => {
    articlesRef.current = currentArticles;
  }, [currentArticles]);

  useEffect(() => {
    onOpenRef.current = onOpenArticle;
  }, [onOpenArticle]);

  function updatePhase(next: VoicePhase) {
    phaseRef.current = next;
    setPhase(next);
  }

  function speak(text: string, nextPhaseAfterSpeech: VoicePhase) {
    setAnnouncement(text);
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      updatePhase(nextPhaseAfterSpeech);
      return;
    }

    try {
      isSpeakingRef.current = true;
      updatePhase("speaking");
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore if already stopped
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      const finish = () => {
        isSpeakingRef.current = false;
        if (!shouldKeepListeningRef.current && nextPhaseAfterSpeech !== "off") {
          updatePhase(nextPhaseAfterSpeech);
          return;
        }
        updatePhase(nextPhaseAfterSpeech);
        if (shouldKeepListeningRef.current && nextPhaseAfterSpeech !== "off") {
          startRecognitionLoop();
        }
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.speak(utterance);
    } catch {
      isSpeakingRef.current = false;
      updatePhase(nextPhaseAfterSpeech);
    }
  }

  async function gatherSearchableArticles(): Promise<ReadableArticle[]> {
    const map = new Map<string, ReadableArticle>();
    for (const item of articlesRef.current) {
      map.set(item.url || item.id, item);
    }
    try {
      const [saved, cachedFeeds] = await Promise.all([getSavedArticles(), listCachedFeeds()]);
      for (const s of saved) {
        const key = s.url || s.id;
        if (!map.has(key)) map.set(key, s);
      }
      for (const cached of cachedFeeds) {
        for (const item of cached.items) {
          const key = item.url || item.id;
          if (!map.has(key)) {
            map.set(key, { ...item, feedTitle: cached.feed.title });
          }
        }
      }
    } catch {
      // IndexedDB unavailable; use in-memory articles only
    }
    return Array.from(map.values());
  }

  async function searchByKeyword(rawKeyword: string) {
    const cleaned = rawKeyword
      .replace(/^(articles?|blogs?|posts?|about|on|for|with keyword)\s+/i, "")
      .replace(/[.?!,]+$/g, "")
      .trim();

    if (!cleaned) {
      speak("Please say a keyword to search for.", "awaiting-keyword");
      return;
    }

    const pool = await gatherSearchableArticles();
    if (pool.length === 0) {
      speak(
        "No feeds or saved articles are loaded yet. Load an RSS feed first, then say Hey Nova to search.",
        "wake-standby",
      );
      return;
    }

    const lower = cleaned.toLowerCase();
    const isAll = lower === "all" || lower === "latest" || lower === "everything";
    const terms = lower.split(/\s+/).filter(Boolean);

    const found = isAll
      ? pool.slice(0, 10)
      : pool.filter((article) => {
          const haystack = `${article.title} ${article.summary} ${article.feedTitle ?? ""} ${article.author ?? ""}`.toLowerCase();
          return terms.every((term) => haystack.includes(term));
        });

    if (found.length === 0) {
      speak(
        `No articles found matching ${cleaned}. Say Hey Nova followed by another keyword to try again.`,
        "wake-standby",
      );
      return;
    }

    matchesRef.current = found;
    matchIndexRef.current = 0;
    setMatches(found);
    setMatchIndex(0);

    const first = found[0];
    const sourceText = first.feedTitle ? `, from ${first.feedTitle}` : "";
    speak(
      `Found ${found.length} ${found.length === 1 ? "article" : "articles"} for ${cleaned}. ` +
        `Result 1: ${first.title}${sourceText}. Say yes to open this article, next for the next heading, or cancel.`,
      "confirming",
    );
  }

  function readCandidateAt(index: number) {
    const list = matchesRef.current;
    if (index >= list.length) {
      speak("End of matching articles. Say Hey Nova to start a new search.", "wake-standby");
      return;
    }
    matchIndexRef.current = index;
    setMatchIndex(index);
    const item = list[index];
    const sourceText = item.feedTitle ? `, from ${item.feedTitle}` : "";
    speak(
      `Result ${index + 1} of ${list.length}: ${item.title}${sourceText}. Say yes to open it, next to skip, or cancel.`,
      "confirming",
    );
  }

  async function processTranscript(raw: string) {
    const text = raw.trim();
    if (!text) return;
    setLastHeard(text);
    const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

    const currentPhase = phaseRef.current;

    // Global cancel command in any active phase
    if (/^(cancel|stop listening|exit|never mind)$/.test(normalized)) {
      speak("Cancelled. Say Hey Nova whenever you need me.", "wake-standby");
      return;
    }

    // Wake phrase ("hey nova", "hi nova", "ok nova", "hello nova") works from standby or any state
    const wakeMatch = normalized.match(/\b(?:hey|hi|hello|ok|okay)\s+nova\b(.*)$/i);
    if (wakeMatch) {
      const remainder = (wakeMatch[1] ?? "").trim();
      if (remainder.length >= 2) {
        await searchByKeyword(remainder);
      } else {
        speak("Hi! Say a keyword for the article you are looking for.", "awaiting-keyword");
      }
      return;
    }

    if (currentPhase === "awaiting-keyword") {
      await searchByKeyword(text);
      return;
    }

    if (currentPhase === "confirming") {
      const candidate = matchesRef.current[matchIndexRef.current];
      if (!candidate) {
        updatePhase("wake-standby");
        return;
      }

      if (/\b(yes|yeah|yep|sure|open|read|okay|ok|go ahead)\b/.test(normalized)) {
        onOpenRef.current(candidate);
        speak(
          `Opening ${candidate.title}. Say read summary to hear its overview, or say Hey Nova for another search.`,
          "wake-standby",
        );
        return;
      }

      if (/\b(no|nope|next|skip)\b/.test(normalized)) {
        readCandidateAt(matchIndexRef.current + 1);
        return;
      }

      if (/\b(repeat|again)\b/.test(normalized)) {
        readCandidateAt(matchIndexRef.current);
        return;
      }
    }

    if (/\b(read summary|read aloud|read overview)\b/.test(normalized)) {
      const current = matchesRef.current[matchIndexRef.current];
      if (current) {
        const overview = current.summary ? current.summary : "No summary was included in the feed for this article.";
        speak(`${current.title}. ${overview}`, "wake-standby");
        return;
      }
    }
  }

  function startRecognitionLoop() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor || isSpeakingRef.current) return;

    try {
      recognitionRef.current?.abort();
    } catch {
      // ignore
    }

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US";

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal && res[0]?.transcript) {
          void processTranscript(res[0].transcript);
        }
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        shouldKeepListeningRef.current = false;
        updatePhase("off");
        setAnnouncement(
          "Microphone access was blocked. Allow microphone permission in your browser, or type a command below.",
        );
      }
    };

    recognition.onend = () => {
      if (shouldKeepListeningRef.current && !isSpeakingRef.current) {
        try {
          recognition.start();
        } catch {
          // ignore rapid restart errors
        }
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // already started
    }
  }

  function enableVoiceMode(triggerImmediatePrompt = false) {
    setPanelOpen(true);
    if (!getSpeechRecognitionCtor()) {
      updatePhase("awaiting-keyword");
      setAnnouncement(
        "Voice recognition is not built into this browser, so you can type a keyword or command below and NOVA will read results aloud.",
      );
      return;
    }

    shouldKeepListeningRef.current = true;
    if (triggerImmediatePrompt) {
      speak("Voice assistant active. Say a keyword to find articles, or say Hey Nova anytime.", "awaiting-keyword");
    } else {
      updatePhase("wake-standby");
      startRecognitionLoop();
      speak("Hands-free mode enabled. Say Hey Nova whenever you want to search articles.", "wake-standby");
    }
  }

  function disableVoiceMode() {
    shouldKeepListeningRef.current = false;
    isSpeakingRef.current = false;
    try {
      recognitionRef.current?.abort();
    } catch {
      // ignore
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    updatePhase("off");
    setAnnouncement("Voice mode turned off.");
  }

  // Keyboard shortcut Alt+V for blind / screen-reader users
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && event.key.toLowerCase() === "v") {
        event.preventDefault();
        if (phaseRef.current === "off") {
          enableVoiceMode(true);
        } else {
          speak("Listening. Say a keyword to search articles.", "awaiting-keyword");
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      shouldKeepListeningRef.current = false;
      try {
        recognitionRef.current?.abort();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleManualSubmit(event: FormEvent) {
    event.preventDefault();
    if (!manualInput.trim()) return;
    if (phaseRef.current === "off") {
      updatePhase("awaiting-keyword");
    }
    const text = manualInput;
    setManualInput("");
    void processTranscript(text);
  }

  const isActive = phase !== "off";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          if (isActive) {
            setPanelOpen((open) => !open);
          } else {
            enableVoiceMode(false);
          }
        }}
        aria-pressed={isActive}
        aria-expanded={panelOpen}
        aria-label={
          isActive
            ? "Hey Nova voice assistant is listening. Open voice assistant controls"
            : "Enable Hey Nova hands-free voice assistant (Alt+V)"
        }
        className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
          isActive
            ? "border-accent bg-accent-soft text-ink"
            : "border-line bg-surface text-ink hover:border-accent hover:text-accent"
        }`}
      >
        {isActive ? (
          <Volume2 aria-hidden="true" className="size-4 text-accent" />
        ) : (
          <Mic aria-hidden="true" className="size-4 text-accent" />
        )}
        <span>{isActive ? "Listening (“Hey Nova”)" : "Hey Nova"}</span>
      </button>

      {/* Screen-reader live region always mounted so spoken status changes are announced */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      {panelOpen && (
        <section
          aria-labelledby="voice-assistant-title"
          className="fixed inset-x-4 bottom-4 z-40 rounded-2xl border border-line bg-surface p-4 shadow-lg sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:bottom-auto sm:mt-2 sm:w-96"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="voice-assistant-title" className="flex items-center gap-2 text-base font-semibold text-ink">
                <Mic aria-hidden="true" className="size-4 text-accent" />
                “Hey Nova” Voice Assistant
              </h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                Say <strong>“Hey Nova”</strong> → speak a keyword → say <strong>“Yes”</strong> to open or{" "}
                <strong>“Next”</strong> to skip. Shortcut: <kbd className="font-mono">Alt+V</kbd>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              aria-label="Hide voice assistant panel"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-ink-muted hover:bg-surface-muted hover:text-ink"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>

          <div className="mt-3 rounded-xl bg-surface-muted p-3 text-sm text-ink">
            <p className="font-medium">{announcement}</p>
            {lastHeard && (
              <p className="mt-1 text-xs text-ink-muted">
                Last heard: <span className="text-ink">“{lastHeard}”</span>
              </p>
            )}
          </div>

          {matches.length > 0 && phase === "confirming" && matches[matchIndex] && (
            <div className="mt-3 rounded-xl border border-line bg-bg p-3 text-sm">
              <p className="text-xs text-ink-muted tabular-nums">
                Match {matchIndex + 1} of {matches.length}
              </p>
              <p className="mt-0.5 font-serif font-semibold text-ink">{matches[matchIndex].title}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void processTranscript("yes")}
                  className="inline-flex min-h-11 items-center rounded-lg bg-accent px-3 text-xs font-semibold text-accent-ink hover:bg-accent-strong"
                >
                  Yes, open article
                </button>
                <button
                  type="button"
                  onClick={() => void processTranscript("next")}
                  className="inline-flex min-h-11 items-center rounded-lg border border-line px-3 text-xs font-medium text-ink hover:border-accent"
                >
                  Next heading
                </button>
              </div>
            </div>
          )}

          <form onSubmit={handleManualSubmit} className="mt-3 flex gap-2">
            <label htmlFor="voice-command-input" className="sr-only">
              Type a voice command or keyword
            </label>
            <input
              id="voice-command-input"
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder={phase === "confirming" ? "Say or type: yes / next" : "Command: Hey Nova privacy"}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-sm text-ink placeholder:text-ink-muted"
            />
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink hover:border-accent hover:text-accent"
            >
              Send
            </button>
          </form>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            {isActive ? (
              <>
                <button
                  type="button"
                  onClick={() => speak("Listening. Say a keyword to search articles.", "awaiting-keyword")}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-ink hover:bg-accent-strong"
                >
                  <Mic aria-hidden="true" className="size-3.5" />
                  Search by keyword now
                </button>
                <button
                  type="button"
                  onClick={disableVoiceMode}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium text-ink hover:border-danger hover:text-danger"
                >
                  <MicOff aria-hidden="true" className="size-3.5" />
                  Turn off mic
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => enableVoiceMode(true)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-ink hover:bg-accent-strong"
              >
                <Mic aria-hidden="true" className="size-3.5" />
                {supported ? "Start listening (“Hey Nova”)" : "Enable audio reader"}
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
