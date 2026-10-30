// @vitest-environment jsdom
// Unit & integration tests for the new NOVA Reader features:
//   1. Preferred reading language(s) prompt & non-preferred language translation
//   2. "Hey Nova" blind-accessible voice assistant workflow
//   3. Dark mode & Light mode toggle
//   4. Draggable resizable reading window
//   5. Removal of "Try:" links below the feed URL search bar
//   6. Instant & localized summary output

import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ArticleCard } from "@/components/ArticleCard";
import { FeedForm } from "@/components/FeedForm";
import { LanguagePreferenceButton, LanguagePreferencesPrompt, LanguageProvider } from "@/components/LanguagePreferences";
import { LocalAiProvider } from "@/components/LocalAiProvider";
import { LocalSummary } from "@/components/LocalSummary";
import { ReaderView } from "@/components/ReaderView";
import { ThemeProvider, ThemeToggle } from "@/components/ThemeProvider";
import { VoiceAssistant } from "@/components/VoiceAssistant";
import { buildExtractiveSummary } from "@/lib/extractive-summary";
import { detectContentLanguage, LANGUAGE_STORAGE_KEY, needsTranslation } from "@/lib/languages";
import type { ReadableArticle } from "@/lib/feed-types";

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("1. Preferred languages & article translation", () => {
  it("prompts for preferred language(s) on first visit and persists the selection", async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <LanguagePreferenceButton />
        <LanguagePreferencesPrompt />
      </LanguageProvider>,
    );

    expect(await screen.findByRole("heading", { name: /Choose your preferred reading language/i })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Spanish/i }));
    await user.click(screen.getByRole("button", { name: "Save language preferences" }));

    expect(screen.queryByRole("heading", { name: /Choose your preferred reading language/i })).toBeNull();
    const stored = JSON.parse(window.localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? "{}");
    expect(stored.onboarded).toBe(true);
    expect(stored.languages).toContain("es");
  });

  it("detects non-preferred article languages and translates on click", async () => {
    expect(detectContentLanguage("La privacidad en la web independiente es esencial para los lectores de blogs.")).toBe("es");
    expect(needsTranslation("es", ["en"])).toBe(true);
    expect(needsTranslation("en", ["en", "fr"])).toBe(false);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ success: true, translatedText: "Independent web privacy is essential" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, JSON.stringify({ languages: ["en"], onboarded: true }));
    const spanishArticle: ReadableArticle = {
      id: "es-1",
      title: "La privacidad en la web independiente es esencial para todos",
      url: "https://blog.example/es",
      summary: "Los lectores merecen leer blogs sin rastreadores ni algoritmos en internet.",
    };

    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <ArticleCard article={spanishArticle} isSaved={false} onToggleSave={() => {}} onRead={() => {}} />
      </LanguageProvider>,
    );

    const translateBtn = await screen.findByRole("button", { name: /Translate to English/i });
    await user.click(translateBtn);

    expect(await screen.findByRole("heading", { name: "Independent web privacy is essential" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Show original/i })).toBeTruthy();
  });
});

describe("2. 'Hey Nova' blind-accessible voice assistant", () => {
  it("responds to 'Hey Nova', searches by keyword, reads headings, and opens the URL when user says 'yes'", async () => {
    const spoken: string[] = [];
    vi.stubGlobal("SpeechSynthesisUtterance", class {
      text: string;
      rate = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        cancel: vi.fn(),
        speak: vi.fn((u: { text: string; onend?: (() => void) | null }) => {
          spoken.push(u.text);
          u.onend?.();
        }),
      },
    });

    const opened: ReadableArticle[] = [];
    const articles: ReadableArticle[] = [
      {
        id: "v-1",
        title: "Accessible Audio Interfaces for the Open Web",
        url: "https://blog.example/audio-web",
        summary: "Designing screen-reader friendly tools.",
        feedTitle: "A11y Weekly",
      },
    ];

    const user = userEvent.setup();
    render(<VoiceAssistant currentArticles={articles} onOpenArticle={(a) => opened.push(a)} />);

    await user.click(screen.getByRole("button", { name: /Enable Hey Nova/i }));
    const cmdInput = screen.getByLabelText("Type a voice command or keyword");

    // 1. Trigger phrase "hey nova"
    await user.type(cmdInput, "hey nova{Enter}");
    expect(spoken.some((s) => /Say a keyword/i.test(s))).toBe(true);

    // 2. Speak keyword "audio"
    await user.type(cmdInput, "audio{Enter}");
    await waitFor(() =>
      expect(spoken.some((s) => s.includes("Accessible Audio Interfaces for the Open Web"))).toBe(true),
    );

    // 3. Confirm with "yes" -> opens that article
    await user.type(cmdInput, "yes{Enter}");
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0].url).toBe("https://blog.example/audio-web");
  });
});

describe("3. Dark mode and light mode", () => {
  it("toggles .dark and .light classes on documentElement and persists choice", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    const toggle = await screen.findByRole("button", { name: /Switch to dark mode/i });
    await user.click(toggle);

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("nova-theme-preference")).toBe("dark");

    await user.click(screen.getByRole("button", { name: /Switch to light mode/i }));
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(window.localStorage.getItem("nova-theme-preference")).toBe("light");
  });
});

describe("4. Draggable reading window & 5. Removed Try links", () => {
  it("removes 'Try:' example links below the feed URL search bar", () => {
    render(<FeedForm onSubmit={() => {}} isLoading={false} />);
    expect(screen.queryByText(/Try:/i)).toBeNull();
  });

  it("allows resizing the reading window via drag separator or keyboard", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const article: ReadableArticle = {
      id: "r-1",
      title: "Resizable Reader",
      url: "https://blog.example/r1",
      summary: "Testing resizable window.",
    };
    render(<ReaderView article={article} onClose={() => {}} />);

    const dialog = screen.getByRole("dialog", { hidden: true });
    const splitter = within(dialog).getByRole("separator", { name: /Drag left or right to resize reading window/i });
    expect(splitter.getAttribute("aria-valuenow")).toBe("720");

    fireEvent.keyDown(splitter, { key: "ArrowLeft" });
    expect(splitter.getAttribute("aria-valuenow")).toBe("768");
  });
});

describe("6. Extractive & localized summary output", () => {
  it("produces an immediate extractive summary and localizes it on demand", async () => {
    const text =
      "Independent RSS feeds allow readers to subscribe directly to authors without algorithmic filtering. " +
      "Local-first storage keeps saved articles available even when the internet connection drops completely. " +
      "Privacy-preserving design ensures reading habits remain strictly on the reader's personal device. " +
      "Open standards like RSS and Atom have endured for decades because no single company owns them.";

    const extracted = buildExtractiveSummary(text, false, 2);
    expect(extracted.ok).toBe(true);
    if (extracted.ok) {
      expect(extracted.text.length).toBeGreaterThan(40);
    }

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ success: true, translatedText: "Les flux RSS indépendants protègent la vie privée." }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, JSON.stringify({ languages: ["fr"], onboarded: true }));
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <LocalAiProvider
          detect={async () => ({
            supported: true,
            device: "wasm",
            webgpu: { available: false, reason: "No WebGPU" },
            approxDownloadMB: 80,
            lowMemory: false,
          })}
        >
          <LocalSummary content={text} isHtml={false} />
        </LocalAiProvider>
      </LanguageProvider>,
    );

    const instantBtn = await screen.findByRole("button", { name: "Instant summary" });
    await user.click(instantBtn);

    const localizeBtn = await screen.findByRole("button", { name: /Localize to French/i });
    await user.click(localizeBtn);

    expect(await screen.findByText("Les flux RSS indépendants protègent la vie privée.")).toBeTruthy();
  });
});
