// @vitest-environment jsdom
// Tests for the Stage 6 reading view (components/ReaderView.tsx + lib/use-article-extraction.ts).
// The page download is faked (fetch); extraction (Readability) and sanitizing
// (DOMPurify) run for real. fake-indexeddb provides real IndexedDB behaviour.
import "fake-indexeddb/auto";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Dexie from "dexie";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderView } from "@/components/ReaderView";
import { closeDatabase, getExtractedArticle, saveArticle } from "@/lib/db";
import type { ReadableArticle, SavedArticle } from "@/lib/feed-types";
import { ARTICLE_PAGE_HTML, ARTICLE_PAGE_URL, NOT_AN_ARTICLE_HTML } from "./helpers/article-fixture";

const ARTICLE: ReadableArticle = {
  id: "feed-a-1",
  title: "Why feeds still matter",
  url: ARTICLE_PAGE_URL,
  summary: "Short feed summary about feeds.",
  feedTitle: "Example Blog",
  publishedAt: "2026-10-25T09:00:00.000Z",
};

const pageResponse = (html = ARTICLE_PAGE_HTML) =>
  new Response(JSON.stringify({ success: true, page: { url: ARTICLE_PAGE_URL, html } }), { status: 200 });
const errorResponse = (code: string, message: string, status: number) =>
  new Response(JSON.stringify({ success: false, error: { code, message } }), { status });

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
}

beforeAll(() => {
  // jsdom has no <dialog> methods; this minimal version is enough for these tests.
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

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  setOnline(true);
  closeDatabase();
  await Dexie.delete("nova-reader");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const body = () => screen.getByRole("dialog", { hidden: true });

describe("ReaderView – full article", () => {
  it("shows the feed text first, then the extracted full article", async () => {
    let release!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    vi.stubGlobal("fetch", fetchMock);
    render(<ReaderView article={ARTICLE} onClose={() => {}} />);

    expect(within(body()).getByText("Short feed summary about feeds.")).toBeTruthy();
    expect(within(body()).getByText("Loading the full article…")).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled()); // after checking for a stored copy
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe(`/api/article?url=${encodeURIComponent(ARTICLE_PAGE_URL)}`);

    await act(async () => release(pageResponse()));
    expect(await within(body()).findByText(/Feeds let readers follow independent writers directly/)).toBeTruthy();
    expect(within(body()).getByRole("button", { name: /Full article/ }).getAttribute("aria-pressed")).toBe("true");
    expect(within(body()).getByText(/Reading view made from the original page/)).toBeTruthy();
    expect(body().textContent).not.toMatch(/BUY CHEAP WIDGETS|ACCEPT ALL COOKIES/);
  });

  it("renders only sanitized content (no scripts, images, iframes, handlers or javascript: links)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => pageResponse()));
    render(<ReaderView article={ARTICLE} onClose={() => {}} />);
    await within(body()).findByText(/The weak spot has always been discovery/);

    const content = body().querySelector(".article-content")!;
    expect(content.innerHTML).not.toMatch(/<script|<iframe|<img|<style|onerror|onclick|javascript:/i);
    for (const link of content.querySelectorAll("a[href]")) {
      expect(link.getAttribute("href")).toMatch(/^https?:\/\//);
      expect(link.getAttribute("rel")).toContain("noopener");
    }
    expect((window as Window & { __pageScriptRan?: boolean }).__pageScriptRan).toBeUndefined();
  });

  it("lets the user switch between the full article and the feed text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => pageResponse()));
    render(<ReaderView article={ARTICLE} onClose={() => {}} />);
    const user = userEvent.setup();
    await within(body()).findByText(/The weak spot has always been discovery/);

    await user.click(within(body()).getByRole("button", { name: /Feed text/ }));
    expect(within(body()).getByText("Short feed summary about feeds.")).toBeTruthy();
    expect(within(body()).queryByText(/The weak spot has always been discovery/)).toBeNull();

    await user.click(within(body()).getByRole("button", { name: /Full article/ }));
    expect(within(body()).getByText(/The weak spot has always been discovery/)).toBeTruthy();
  });

  it("always keeps a safe link to the original article", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => pageResponse()));
    render(<ReaderView article={ARTICLE} onClose={() => {}} />);
    const link = within(body()).getByRole("link", { name: /Read the original article/ });
    expect(link.getAttribute("href")).toBe(ARTICLE_PAGE_URL);
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("stores the full article so it opens offline next time", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => pageResponse()));
    render(<ReaderView article={ARTICLE} onClose={() => {}} />);
    await within(body()).findByText(/The weak spot has always been discovery/);
    await waitFor(async () => expect(await getExtractedArticle(ARTICLE_PAGE_URL)).toBeDefined());

    cleanup();
    setOnline(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ReaderView article={ARTICLE} onClose={() => {}} />);
    expect(await within(body()).findByText(/The weak spot has always been discovery/)).toBeTruthy();
    expect(within(body()).getByText(/Stored on this device for offline reading/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("works for saved articles (offline, with the stored full text)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => pageResponse()));
    const saved: SavedArticle = await saveArticle(ARTICLE, "Example Blog");
    render(<ReaderView article={saved} onClose={() => {}} />);
    await within(body()).findByText(/The weak spot has always been discovery/);
    cleanup();

    setOnline(false);
    render(<ReaderView article={saved} onClose={() => {}} />);
    expect(await within(body()).findByText(/The weak spot has always been discovery/)).toBeTruthy();
  });
});

describe("ReaderView – fallbacks", () => {
  it("falls back to the feed text when no article can be extracted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => pageResponse(NOT_AN_ARTICLE_HTML)));
    render(<ReaderView article={ARTICLE} onClose={() => {}} />);
    expect(await within(body()).findByText(/Full article unavailable: .*Showing the text from the feed instead\./)).toBeTruthy();
    expect(within(body()).getByText("Short feed summary about feeds.")).toBeTruthy();
    expect(within(body()).queryByRole("button", { name: "Try again" })).toBeNull(); // retrying would not help
    expect(within(body()).getByRole("link", { name: /Read the original article/ })).toBeTruthy();
  });

  it("explains server errors such as a non-HTML link", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      errorResponse("UNSUPPORTED_CONTENT_TYPE", "This link returned application/pdf, not a web page, so it cannot be shown in the reader.", 415),
    ));
    render(<ReaderView article={ARTICLE} onClose={() => {}} />);
    expect(await within(body()).findByText(/application\/pdf, not a web page/)).toBeTruthy();
  });

  it("offers Try again after a temporary failure, and recovers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse("TIMEOUT", "The article took too long to respond.", 504))
      .mockResolvedValueOnce(pageResponse());
    vi.stubGlobal("fetch", fetchMock);
    render(<ReaderView article={ARTICLE} onClose={() => {}} />);
    const user = userEvent.setup();

    await within(body()).findByText(/The article took too long to respond\./);
    await user.click(within(body()).getByRole("button", { name: "Try again" }));
    expect(await within(body()).findByText(/The weak spot has always been discovery/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("explains when offline and nothing is stored", async () => {
    setOnline(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ReaderView article={ARTICLE} onClose={() => {}} />);
    expect(await within(body()).findByText(/You are offline, and the full article has not been stored/)).toBeTruthy();
    expect(within(body()).getByText("Short feed summary about feeds.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
