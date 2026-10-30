"use client";
// Hands-free voice assistant for blind and low-vision readers ("Hey Nova").
// Dual-engine microphone architecture:
//   1. Explicitly requests `navigator.mediaDevices.getUserMedia({ audio: true })`
//      on click so the browser shows its native microphone permission dialog.
//   2. Uses native `SpeechRecognition` when supported and permitted, AND automatically
//      falls back to `MediaRecorder` + Web Audio silence detection + `POST /api/transcribe`
//      (gemini-3.5-transcribe) whenever running inside cross-origin iframes, Firefox,
//      Safari, or Brave where `webkitSpeechRecognition` is blocked or absent.

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { ExternalLink, LoaderCircle, Mic, MicOff, Square, Volume2, X } from "lucide-react";
import { getSavedArticles, listCachedFeeds } from "@/lib/db";
import type { ReadableArticle } from "@/lib/feed-types";

type VoicePhase =
  | "off"
  | "wake-standby" // listening for "hey nova"
  | "awaiting-keyword" // heard "hey nova", listening for search keyword
  | "transcribing" // uploading recorded clip to /api/transcribe
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

function hasMediaRecorderSupport(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined"
  );
}

const noopSubscribe = () => () => {};

type VoiceAssistantProps = {
  currentArticles: ReadableArticle[];
  onOpenArticle: (article: ReadableArticle) => void;
};

export function VoiceAssistant({ currentArticles, onOpenArticle }: VoiceAssistantProps) {
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => Boolean(getSpeechRecognitionCtor()) || hasMediaRecorderSupport(),
    () => false,
  );
  const inIframe = useSyncExternalStore(
    noopSubscribe,
    () => {
      try {
        return window.self !== window.top;
      } catch {
        return true;
      }
    },
    () => false,
  );
  const currentHref = useSyncExternalStore(
    noopSubscribe,
    () => window.location.href,
    () => "/",
  );

  const [phase, setPhase] = useState<VoicePhase>("off");
  const [panelOpen, setPanelOpen] = useState(false);
  const [micBlocked, setMicBlocked] = useState(false);
  const [isRecordingClip, setIsRecordingClip] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [announcement, setAnnouncement] = useState<string>(
    "Say “Hey Nova” when voice mode is active, or press Alt+V to search articles by voice.",
  );
  const [lastHeard, setLastHeard] = useState<string>("");
  const [matches, setMatches] = useState<ReadableArticle[]>([]);
  const [matchIndex, setMatchIndex] = useState(0);
  const [manualInput, setManualInput] = useState("");

  const phaseRef = useRef<VoicePhase>("off");
  const preTranscribePhaseRef = useRef<VoicePhase>("awaiting-keyword");
  const matchesRef = useRef<ReadableArticle[]>([]);
  const matchIndexRef = useRef(0);
  const articlesRef = useRef<ReadableArticle[]>(currentArticles);
  const onOpenRef = useRef(onOpenArticle);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const levelRafRef = useRef<number | null>(null);
  const useRecorderFallbackRef = useRef(false);
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

  function releaseMediaResources() {
    if (levelRafRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
    setMicLevel(0);
    setIsRecordingClip(false);
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    } catch {
      // ignore
    }
    mediaRecorderRef.current = null;
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }

  function resumeListeningAfterSpeech(targetPhase: VoicePhase) {
    if (!shouldKeepListeningRef.current || targetPhase === "off") return;
    if (useRecorderFallbackRef.current) {
      void startClipRecording();
    } else {
      startRecognitionLoop();
    }
  }

  function speak(text: string, nextPhaseAfterSpeech: VoicePhase) {
    setAnnouncement(text);
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      updatePhase(nextPhaseAfterSpeech);
      resumeListeningAfterSpeech(nextPhaseAfterSpeech);
      return;
    }

    try {
      isSpeakingRef.current = true;
      updatePhase("speaking");
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      } catch {
        // ignore
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      let finished = false;
      const watchdogMs = Math.min(18_000, Math.max(3_200, text.length * 80));
      const watchdog = window.setTimeout(() => {
        if (!finished && !window.speechSynthesis.speaking) {
          finish();
        }
      }, watchdogMs);

      function finish() {
        if (finished) return;
        finished = true;
        window.clearTimeout(watchdog);
        isSpeakingRef.current = false;
        updatePhase(nextPhaseAfterSpeech);
        resumeListeningAfterSpeech(nextPhaseAfterSpeech);
      }

      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.speak(utterance);
    } catch {
      isSpeakingRef.current = false;
      updatePhase(nextPhaseAfterSpeech);
      resumeListeningAfterSpeech(nextPhaseAfterSpeech);
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

    const currentPhase = phaseRef.current === "transcribing" ? preTranscribePhaseRef.current : phaseRef.current;

    if (/^(cancel|stop listening|exit|never mind)$/.test(normalized)) {
      speak("Cancelled. Say Hey Nova whenever you need me.", "wake-standby");
      return;
    }

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

    // Convenience: if user clicked "Record voice command" while in wake-standby and spoke a keyword directly, search it!
    if (currentPhase === "wake-standby" && useRecorderFallbackRef.current && normalized.length >= 2) {
      await searchByKeyword(text);
    }
  }

  /** Requests real browser microphone stream and starts live audio level meter. */
  async function ensureMicrophoneStream(): Promise<MediaStream | null> {
    if (mediaStreamRef.current && mediaStreamRef.current.active) {
      setMicBlocked(false);
      return mediaStreamRef.current;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return null;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      mediaStreamRef.current = stream;
      setMicBlocked(false);

      // Attach live visual audio meter
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (!mediaStreamRef.current?.active) return;
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          const avg = sum / data.length;
          setMicLevel(Math.min(100, Math.round((avg / 90) * 100)));
          levelRafRef.current = window.requestAnimationFrame(tick);
        };
        levelRafRef.current = window.requestAnimationFrame(tick);
      }

      return stream;
    } catch {
      setMicBlocked(true);
      return null;
    }
  }

  /** Fallback recorder using MediaRecorder + silence detection + /api/transcribe (gemini-3.5-transcribe). */
  async function startClipRecording() {
    if (isSpeakingRef.current) return;
    const stream = await ensureMicrophoneStream();
    if (!stream || typeof MediaRecorder === "undefined") {
      setAnnouncement(
        "Microphone permission is blocked by your browser or iframe settings. Allow microphone access in the address bar, open in a full tab, or type your command below.",
      );
      return;
    }

    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    } catch {
      // ignore
    }

    const preferredMime =
      typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";

    const recorder = preferredMime ? new MediaRecorder(stream, { mimeType: preferredMime }) : new MediaRecorder(stream);
    const chunks: BlobPart[] = [];
    let heardVoice = false;
    let silenceSince = Date.now();
    const startedAt = Date.now();

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    const silenceCheckInterval = window.setInterval(() => {
      if (recorder.state !== "recording") {
        window.clearInterval(silenceCheckInterval);
        return;
      }
      // Auto-stop after 7s max or 1.4s of quiet after voice was detected
      const elapsed = Date.now() - startedAt;
      if (elapsed > 7_500 || (heardVoice && Date.now() - silenceSince > 1_400)) {
        window.clearInterval(silenceCheckInterval);
        try {
          recorder.stop();
        } catch {
          // ignore
        }
      }
    }, 200);

    // Watch mic level via AudioContext analyser if available
    const monitorStream = audioContextRef.current;
    let monitorRaf: number | null = null;
    if (monitorStream) {
      const source = monitorStream.createMediaStreamSource(stream);
      const analyser = monitorStream.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const checkVoice = () => {
        if (recorder.state !== "recording") return;
        analyser.getByteFrequencyData(buf);
        let total = 0;
        for (let i = 0; i < buf.length; i++) total += buf[i];
        const mean = total / buf.length;
        if (mean > 14) {
          heardVoice = true;
          silenceSince = Date.now();
        }
        monitorRaf = window.requestAnimationFrame(checkVoice);
      };
      monitorRaf = window.requestAnimationFrame(checkVoice);
    }

    recorder.onstop = async () => {
      window.clearInterval(silenceCheckInterval);
      if (monitorRaf !== null) window.cancelAnimationFrame(monitorRaf);
      setIsRecordingClip(false);
      if (isSpeakingRef.current || chunks.length === 0) return;

      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      if (blob.size < 800) {
        if (shouldKeepListeningRef.current && !isSpeakingRef.current) {
          void startClipRecording();
        }
        return;
      }

      preTranscribePhaseRef.current = phaseRef.current === "off" ? "awaiting-keyword" : phaseRef.current;
      updatePhase("transcribing");
      setAnnouncement("Transcribing your voice command…");

      try {
        const base64 = await blobToBase64(blob);
        const res = await fetch("/api/transcribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ audioBase64: base64, mimeType: blob.type || "audio/webm" }),
        });
        const data = (await res.json()) as { success?: boolean; transcript?: string; error?: { message?: string } };
        updatePhase(preTranscribePhaseRef.current);

        if (res.ok && data.success && data.transcript?.trim()) {
          await processTranscript(data.transcript.trim());
        } else if (shouldKeepListeningRef.current && !isSpeakingRef.current) {
          setAnnouncement("Listening… Say “Hey Nova” and a keyword, or tap Stop when finished speaking.");
          void startClipRecording();
        }
      } catch {
        updatePhase(preTranscribePhaseRef.current);
        setAnnouncement("Could not reach voice transcription right now. Try speaking again or type below.");
      }
    };

    mediaRecorderRef.current = recorder;
    setIsRecordingClip(true);
    recorder.start();
  }

  function stopClipRecordingNow() {
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    } catch {
      // ignore
    }
  }

  function startRecognitionLoop() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      useRecorderFallbackRef.current = true;
      void startClipRecording();
      return;
    }
    if (isSpeakingRef.current) return;

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
      if (
        event.error === "not-allowed" ||
        event.error === "service-not-allowed" ||
        event.error === "network" ||
        event.error === "audio-capture"
      ) {
        // Browser SpeechRecognition failed or is restricted inside iframe -> seamlessly switch to MediaRecorder + /api/transcribe!
        if (hasMediaRecorderSupport()) {
          useRecorderFallbackRef.current = true;
          try {
            recognition.abort();
          } catch {
            // ignore
          }
          void startClipRecording();
          return;
        }
        shouldKeepListeningRef.current = false;
        setMicBlocked(true);
        updatePhase("off");
        setAnnouncement(
          "Microphone access was blocked. Allow microphone permission in your browser address bar, or type a command below.",
        );
      }
    };

    recognition.onend = () => {
      if (shouldKeepListeningRef.current && !isSpeakingRef.current && !useRecorderFallbackRef.current) {
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
      if (hasMediaRecorderSupport()) {
        useRecorderFallbackRef.current = true;
        void startClipRecording();
      }
    }
  }

  async function enableVoiceMode(triggerImmediatePrompt = false) {
    setPanelOpen(true);

    // 1. Trigger native browser microphone prompt right inside the user click gesture!
    const stream = await ensureMicrophoneStream();

    if (!getSpeechRecognitionCtor() && !stream) {
      updatePhase("awaiting-keyword");
      setAnnouncement(
        "Microphone access wasn't granted by this browser frame. Allow microphone in your address bar (or open in a full tab), or type your voice command below and NOVA will still read results aloud.",
      );
      return;
    }

    if (!getSpeechRecognitionCtor() && stream) {
      useRecorderFallbackRef.current = true;
    }

    shouldKeepListeningRef.current = true;
    if (triggerImmediatePrompt) {
      speak("Voice assistant active. Say a keyword to find articles, or say Hey Nova anytime.", "awaiting-keyword");
    } else {
      updatePhase("wake-standby");
      if (useRecorderFallbackRef.current) {
        speak("Hands-free microphone active. Say Hey Nova and your keyword.", "wake-standby");
      } else {
        startRecognitionLoop();
        speak("Hands-free mode enabled. Say Hey Nova whenever you want to search articles.", "wake-standby");
      }
    }
  }

  function disableVoiceMode() {
    shouldKeepListeningRef.current = false;
    isSpeakingRef.current = false;
    useRecorderFallbackRef.current = false;
    try {
      recognitionRef.current?.abort();
    } catch {
      // ignore
    }
    releaseMediaResources();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    updatePhase("off");
    setAnnouncement("Voice mode turned off.");
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && event.key.toLowerCase() === "v") {
        event.preventDefault();
        if (phaseRef.current === "off") {
          void enableVoiceMode(true);
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
      releaseMediaResources();
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
            void enableVoiceMode(false);
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

          <ol className="mt-3 grid grid-cols-3 gap-1.5 text-xs" aria-label="How voice search works">
            <li
              className={`rounded-lg border px-2 py-1.5 ${
                phase === "wake-standby" ? "border-accent bg-accent-soft font-semibold text-ink" : "border-line text-ink-muted"
              }`}
            >
              1. Say “Hey Nova”
            </li>
            <li
              className={`rounded-lg border px-2 py-1.5 ${
                phase === "awaiting-keyword" ? "border-accent bg-accent-soft font-semibold text-ink" : "border-line text-ink-muted"
              }`}
            >
              2. Say keyword
            </li>
            <li
              className={`rounded-lg border px-2 py-1.5 ${
                phase === "confirming" ? "border-accent bg-accent-soft font-semibold text-ink" : "border-line text-ink-muted"
              }`}
            >
              3. Say “Yes” / “Next”
            </li>
          </ol>

          {/* Live microphone input level bar when mic stream is active */}
          {isActive && !micBlocked && (
            <div className="mt-2.5 flex items-center gap-2 text-xs text-ink-muted">
              <span id="mic-level-label">Mic input</span>
              <progress
                aria-labelledby="mic-level-label"
                max={100}
                value={Math.max(6, micLevel)}
                className="h-2 flex-1 overflow-hidden rounded-full accent-[var(--accent)]"
              />
              {phase === "transcribing" && <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin text-accent" />}
            </div>
          )}

          <div className="mt-2.5 rounded-xl bg-surface-muted p-3 text-sm text-ink">
            <p className="font-medium">{announcement}</p>
            {lastHeard && (
              <p className="mt-1 text-xs text-ink-muted">
                Last heard: <span className="text-ink">“{lastHeard}”</span>
              </p>
            )}
            {micBlocked && inIframe && (
              <p className="mt-2 border-t border-line pt-2 text-xs text-ink-muted">
                Your browser blocked microphone access inside the embedded preview frame. Allow Microphone in your
                browser&apos;s site icon, or{" "}
                <a
                  href={currentHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-accent underline underline-offset-2"
                >
                  open NOVA Reader in a full browser tab
                  <ExternalLink aria-hidden="true" className="size-3" />
                </a>
                .
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
                {isRecordingClip ? (
                  <button
                    type="button"
                    onClick={stopClipRecordingNow}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-ink hover:bg-accent-strong"
                  >
                    <Square aria-hidden="true" className="size-3.5" />
                    Done speaking (Send)
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      useRecorderFallbackRef.current = true;
                      updatePhase(phaseRef.current === "confirming" ? "confirming" : "awaiting-keyword");
                      setAnnouncement("Listening now — speak your keyword or command, then pause.");
                      void startClipRecording();
                    }}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-ink hover:bg-accent-strong"
                  >
                    <Mic aria-hidden="true" className="size-3.5" />
                    Speak command now
                  </button>
                )}
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
                onClick={() => void enableVoiceMode(true)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-ink hover:bg-accent-strong"
              >
                <Mic aria-hidden="true" className="size-3.5" />
                {supported ? "Allow mic & start (“Hey Nova”)" : "Enable audio reader"}
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const commaIdx = result.indexOf(",");
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}
