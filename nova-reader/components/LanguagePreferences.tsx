"use client";
// Preferred reading language(s) context, first-visit language onboarding prompt,
// and persistent header button for updating language preferences anytime.

import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Check, Globe, Languages, X } from "lucide-react";
import {
  getLanguageName,
  LANGUAGE_STORAGE_KEY,
  normalizeLangCode,
  SUPPORTED_LANGUAGES,
} from "@/lib/languages";

type LanguageContextValue = {
  preferredLanguages: string[];
  primaryLanguage: string;
  needsOnboarding: boolean;
  isPickerOpen: boolean;
  openPicker: () => void;
  closePicker: () => void;
  savePreferences: (codes: string[]) => void;
};

const DEFAULT_CONTEXT: LanguageContextValue = {
  preferredLanguages: ["en"],
  primaryLanguage: "en",
  needsOnboarding: false,
  isPickerOpen: false,
  openPicker: () => {},
  closePicker: () => {},
  savePreferences: () => {},
};

const LanguageContext = createContext<LanguageContextValue>(DEFAULT_CONTEXT);

export function useLanguagePreferences(): LanguageContextValue {
  return useContext(LanguageContext);
}

type StoredPrefs = {
  languages: string[];
  onboarded: boolean;
};

const langListeners = new Set<() => void>();

function notifyLangListeners() {
  for (const listener of langListeners) listener();
}

function subscribeLanguages(onChange: () => void): () => void {
  langListeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === LANGUAGE_STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    langListeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function detectBrowserDefaultLanguages(): string[] {
  if (typeof navigator === "undefined") return ["en"];
  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
  const valid = candidates
    .map((c) => normalizeLangCode(c))
    .filter((c): c is string => Boolean(c));
  const unique = Array.from(new Set(valid));
  return unique.length > 0 ? unique.slice(0, 2) : ["en"];
}

/**
 * Primitive snapshot string `"1:en,es"` (onboarded) or `"0:en"` (needs onboarding)
 * so useSyncExternalStore compares snapshots with `Object.is` cleanly.
 */
function getLanguageSnapshot(): string {
  if (typeof window === "undefined") return "1:en";
  try {
    const raw = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredPrefs>;
      if (Array.isArray(parsed.languages) && parsed.languages.length > 0) {
        const cleaned = Array.from(
          new Set(parsed.languages.map((l) => normalizeLangCode(l)).filter((l): l is string => Boolean(l))),
        );
        if (cleaned.length > 0) {
          return `${parsed.onboarded ? "1" : "0"}:${cleaned.join(",")}`;
        }
      }
    }
  } catch {
    // ignore malformed storage
  }
  const detected = detectBrowserDefaultLanguages();
  return `0:${detected.join(",")}`;
}

function getLanguageServerSnapshot(): string {
  return "1:en";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(subscribeLanguages, getLanguageSnapshot, getLanguageServerSnapshot);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const needsOnboarding = snapshot.startsWith("0:");
  const preferredLanguages = useMemo(() => {
    const codes = snapshot
      .slice(2)
      .split(",")
      .filter(Boolean);
    return codes.length > 0 ? codes : ["en"];
  }, [snapshot]);

  function savePreferences(codes: string[]) {
    const cleaned = Array.from(
      new Set(codes.map((c) => normalizeLangCode(c)).filter((c): c is string => Boolean(c))),
    );
    const next = cleaned.length > 0 ? cleaned : ["en"];
    setIsPickerOpen(false);
    try {
      const payload: StoredPrefs = { languages: next, onboarded: true };
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage errors
    }
    notifyLangListeners();
  }

  return (
    <LanguageContext.Provider
      value={{
        preferredLanguages,
        primaryLanguage: preferredLanguages[0] ?? "en",
        needsOnboarding,
        isPickerOpen,
        openPicker: () => setIsPickerOpen(true),
        closePicker: () => setIsPickerOpen(false),
        savePreferences,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

/** Header button showing active preferred language codes, opening the selector panel. */
export function LanguagePreferenceButton() {
  const { preferredLanguages, isPickerOpen, openPicker, closePicker } = useLanguagePreferences();
  const summary = preferredLanguages
    .slice(0, 2)
    .map((c) => c.toUpperCase())
    .join(", ");
  const extra = preferredLanguages.length > 2 ? `+${preferredLanguages.length - 2}` : "";

  return (
    <button
      type="button"
      onClick={() => (isPickerOpen ? closePicker() : openPicker())}
      aria-expanded={isPickerOpen}
      aria-label={`Preferred reading languages: ${preferredLanguages.map(getLanguageName).join(", ")}. Click to change.`}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent whitespace-nowrap shrink-0"
    >
      <Globe aria-hidden="true" className="size-4 text-accent" />
      <span>
        {summary}
        {extra}
      </span>
    </button>
  );
}

/**
 * Displayed automatically on first visit (`needsOnboarding === true`) or when the user
 * clicks the header language button (`isPickerOpen === true`).
 */
export function LanguagePreferencesPrompt() {
  const { preferredLanguages, needsOnboarding, isPickerOpen, closePicker, savePreferences } =
    useLanguagePreferences();
  const visible = needsOnboarding || isPickerOpen;

  if (!visible) return null;

  return (
    <LanguagePreferencesForm
      key={preferredLanguages.join(",")}
      initialLanguages={preferredLanguages}
      needsOnboarding={needsOnboarding}
      onClose={closePicker}
      onSave={savePreferences}
    />
  );
}

function LanguagePreferencesForm({
  initialLanguages,
  needsOnboarding,
  onClose,
  onSave,
}: {
  initialLanguages: string[];
  needsOnboarding: boolean;
  onClose: () => void;
  onSave: (codes: string[]) => void;
}) {
  const [draft, setDraft] = useState<string[]>(initialLanguages);

  function toggleCode(code: string) {
    setDraft((current) => {
      if (current.includes(code)) {
        return current.length > 1 ? current.filter((item) => item !== code) : current;
      }
      return [...current, code];
    });
  }

  return (
    <section aria-labelledby="language-prefs-heading" className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
      <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="language-prefs-heading" className="flex items-center gap-2 text-lg font-semibold text-ink">
              <Languages aria-hidden="true" className="size-5 text-accent" />
              {needsOnboarding ? "Choose your preferred reading language(s)" : "Reading language preferences"}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Select all languages you read comfortably. Whenever an article is written in another language, NOVA Reader
              will offer one-tap translation into{" "}
              <span className="font-medium text-ink">{getLanguageName(draft[0] ?? "en")}</span> (your first selection).
            </p>
          </div>
          {!needsOnboarding && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close language preferences"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-ink-muted hover:bg-surface-muted hover:text-ink"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          )}
        </div>

        <div
          role="group"
          aria-label="Available reading languages"
          className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
        >
          {SUPPORTED_LANGUAGES.map((lang) => {
            const selected = draft.includes(lang.code);
            const isPrimary = draft[0] === lang.code;
            return (
              <button
                key={lang.code}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleCode(lang.code)}
                className={`flex min-h-12 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                  selected
                    ? "border-accent bg-accent-soft font-semibold text-ink"
                    : "border-line bg-bg text-ink hover:border-accent"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate">{lang.name}</span>
                  <span className="block truncate text-xs font-normal text-ink-muted">
                    {lang.nativeName}
                    {isPrimary ? " · Primary" : ""}
                  </span>
                </span>
                {selected && <Check aria-hidden="true" className="size-4 shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-xs text-ink-muted">
            Selected: <span className="font-medium text-ink">{draft.map(getLanguageName).join(", ")}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {!needsOnboarding && (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-medium text-ink hover:border-accent"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={() => onSave(draft)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-strong"
            >
              Save language preferences
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
