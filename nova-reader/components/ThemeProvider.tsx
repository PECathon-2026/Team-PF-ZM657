"use client";
// Dual-theme Light / Dark mode provider and accessible toggle button.
// Uses useSyncExternalStore for tear-free, hydration-safe state and syncs `.dark`
// and `.light` classes on `document.documentElement`.

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";

export type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  theme: ResolvedTheme;
  toggleTheme: () => void;
  setTheme: (next: ResolvedTheme) => void;
};

const STORAGE_KEY = "nova-theme-preference";
const themeListeners = new Set<() => void>();

function notifyThemeListeners() {
  for (const listener of themeListeners) listener();
}

function subscribeTheme(onChange: () => void): () => void {
  themeListeners.add(onChange);
  const media =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;

  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onChange();
  };

  window.addEventListener("storage", onStorage);
  media?.addEventListener?.("change", onChange);

  return () => {
    themeListeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
    media?.removeEventListener?.("change", onChange);
  };
}

function getThemeSnapshot(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // localStorage blocked or unavailable
  }
  if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function getThemeServerSnapshot(): ResolvedTheme {
  return "light";
}

function applyThemeToDocument(theme: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
  root.style.colorScheme = theme;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  toggleTheme: () => {},
  setTheme: () => {},
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeServerSnapshot);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  function setTheme(next: ResolvedTheme) {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage errors in private browsing
    }
    applyThemeToDocument(next);
    notifyThemeListeners();
  }

  function toggleTheme() {
    setTheme(theme === "dark" ? "light" : "dark");
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent whitespace-nowrap shrink-0"
    >
      {isDark ? (
        <Sun aria-hidden="true" className="size-4 text-accent" />
      ) : (
        <Moon aria-hidden="true" className="size-4 text-accent" />
      )}
      <span className="hidden sm:inline">{isDark ? "Light" : "Dark"}</span>
    </button>
  );
}
