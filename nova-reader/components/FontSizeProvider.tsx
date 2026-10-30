"use client";
// User-adjustable font size provider & A- / A+ control.
// Uses useSyncExternalStore for hydration-safe state and scales root <html>
// font-size so rem-based typography across the entire site and ReaderView adapts cleanly.

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Minus, Plus, Type as TypeIcon } from "lucide-react";

export type FontScaleKey = "sm" | "md" | "lg" | "xl";

export const FONT_SCALES: { key: FontScaleKey; label: string; rootCss: string; percentLabel: string }[] = [
  { key: "sm", label: "Small", rootCss: "93.75%", percentLabel: "94%" },
  { key: "md", label: "Standard", rootCss: "100%", percentLabel: "100%" },
  { key: "lg", label: "Large", rootCss: "112.5%", percentLabel: "112%" },
  { key: "xl", label: "Extra large", rootCss: "125%", percentLabel: "125%" },
];

const STORAGE_KEY = "nova-font-scale";
const listeners = new Set<() => void>();

function notifyListeners() {
  for (const l of listeners) l();
}

function subscribeFontScale(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function isFontScaleKey(val: string | null): val is FontScaleKey {
  return val === "sm" || val === "md" || val === "lg" || val === "xl";
}

function getFontScaleSnapshot(): FontScaleKey {
  if (typeof window === "undefined") return "md";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (isFontScaleKey(raw)) return raw;
  } catch {
    // ignore storage errors
  }
  return "md";
}

function getFontScaleServerSnapshot(): FontScaleKey {
  return "md";
}

function applyFontScaleToDocument(scale: FontScaleKey) {
  if (typeof document === "undefined") return;
  const entry = FONT_SCALES.find((item) => item.key === scale) ?? FONT_SCALES[1];
  document.documentElement.style.fontSize = entry.rootCss;
  document.documentElement.dataset.fontScale = scale;
}

type FontSizeContextValue = {
  scale: FontScaleKey;
  setScale: (next: FontScaleKey) => void;
  decrease: () => void;
  increase: () => void;
  canDecrease: boolean;
  canIncrease: boolean;
};

const FontSizeContext = createContext<FontSizeContextValue>({
  scale: "md",
  setScale: () => {},
  decrease: () => {},
  increase: () => {},
  canDecrease: true,
  canIncrease: true,
});

export function useFontSize(): FontSizeContextValue {
  return useContext(FontSizeContext);
}

export function FontSizeProvider({ children }: { children: ReactNode }) {
  const scale = useSyncExternalStore(subscribeFontScale, getFontScaleSnapshot, getFontScaleServerSnapshot);

  useEffect(() => {
    applyFontScaleToDocument(scale);
  }, [scale]);

  function setScale(next: FontScaleKey) {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage errors
    }
    applyFontScaleToDocument(next);
    notifyListeners();
  }

  const index = FONT_SCALES.findIndex((item) => item.key === scale);
  const safeIndex = index === -1 ? 1 : index;

  function decrease() {
    if (safeIndex > 0) setScale(FONT_SCALES[safeIndex - 1].key);
  }

  function increase() {
    if (safeIndex < FONT_SCALES.length - 1) setScale(FONT_SCALES[safeIndex + 1].key);
  }

  return (
    <FontSizeContext.Provider
      value={{
        scale,
        setScale,
        decrease,
        increase,
        canDecrease: safeIndex > 0,
        canIncrease: safeIndex < FONT_SCALES.length - 1,
      }}
    >
      {children}
    </FontSizeContext.Provider>
  );
}

export function FontSizeControl({ compact = false }: { compact?: boolean }) {
  const { scale, decrease, increase, canDecrease, canIncrease } = useFontSize();
  const current = FONT_SCALES.find((item) => item.key === scale) ?? FONT_SCALES[1];

  return (
    <div
      role="group"
      aria-label={`Text size (${current.label})`}
      className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-1 text-sm text-ink shrink-0"
    >
      <button
        type="button"
        onClick={decrease}
        disabled={!canDecrease}
        aria-label="Decrease font size"
        title="Decrease font size"
        className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg px-2 text-ink transition-transform hover:bg-surface-muted hover:text-accent disabled:opacity-40"
      >
        <Minus aria-hidden="true" className="size-3.5" />
        <span className="sr-only">Smaller text</span>
      </button>
      <span
        className="inline-flex items-center gap-1 px-1.5 text-xs font-semibold text-ink-muted tabular-nums select-none"
        title={`Current text size: ${current.label} (${current.percentLabel})`}
      >
        <TypeIcon aria-hidden="true" className="size-3.5 text-accent" />
        {!compact && <span className="hidden sm:inline">{current.percentLabel}</span>}
      </span>
      <button
        type="button"
        onClick={increase}
        disabled={!canIncrease}
        aria-label="Increase font size"
        title="Increase font size"
        className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg px-2 text-ink transition-transform hover:bg-surface-muted hover:text-accent disabled:opacity-40"
      >
        <Plus aria-hidden="true" className="size-3.5" />
        <span className="sr-only">Larger text</span>
      </button>
    </div>
  );
}
