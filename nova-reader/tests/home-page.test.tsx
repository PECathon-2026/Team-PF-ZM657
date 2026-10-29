// @vitest-environment jsdom
// Tests for the Stage 4 frontend (app/page.tsx and its components).
// The page is rendered in a fake browser (jsdom). `fetch` is replaced with a
// fake, so these tests check the UI logic only — no server or network.
import "fake-indexeddb/auto"; // jsdom has no IndexedDB; this in-memory version lets the saved-articles panel work
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";

const FEED_URL = "https://mock.example/feed.xml";

const SUCCESS = {
  success: true,
  feed: {
    title: "The Small Web Journal",
    description: "Essays about blogs and feeds.",
    siteUrl: "https://mock.example/",
    feedUrl: FEED_URL,
  },
  items: [
    {
      id: "f-1",
      title: "Why feeds still matter",
      url: "https://mock.example/feeds-matter",
      summary: "Feeds let you follow writers directly.",
      author: "Meera Kaur",
      publishedAt: "2026-10-25T09:00:00.000Z",
    },
    { id: "f-2", title: "A post without extras", url: "https://mock.example/plain", summary: "" },
  ],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A fetch whose answer we release by hand, to look at the loading state. */
function deferredFetch() {
  let release!: (response: Response) => void;
  const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
  return { fetchMock, release: (response: Response) => release(response) };
}

async function submitUrl(url: string) {
  const user = userEvent.setup();
  const input = screen.getByLabelText("RSS or Atom feed URL");
  await user.clear(input);
  await user.type(input, url);
  await user.click(screen.getByRole("button", { name: "Load feed" }));
  return user;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {}); // keep test output clean
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HomePage – form", () => {
  it("has a labelled URL input and a submit button", () => {
    render(<HomePage />);
    expect(screen.getByLabelText("RSS or Atom feed URL")).toHaveProperty("type", "url");
    expect(screen.getByRole("button", { name: "Load feed" })).toBeTruthy();
    expect(screen.getByText("No feed loaded yet")).toBeTruthy();
  });

  it("shows a clear validation error and does not call the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<HomePage />);

    await submitUrl("not a url");

    const input = screen.getByLabelText("RSS or Atom feed URL");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/This is not a valid URL/)).toBeTruthy();
    expect(input.getAttribute("aria-describedby")).toContain("feed-url-error");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unsafe URLs in the browser too", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<HomePage />);
    await submitUrl("javascript:alert(1)");
    expect(screen.getByText("Only http:// and https:// URLs are supported.")).toBeTruthy();
  });

  it("can be submitted with the Enter key", async () => {
    const fetchMock = vi.fn(async () => json(SUCCESS));
    vi.stubGlobal("fetch", fetchMock);
    render(<HomePage />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("RSS or Atom feed URL"), `${FEED_URL}{Enter}`);
    await screen.findByRole("heading", { name: "The Small Web Journal" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("HomePage – loading and success", () => {
  it("calls the Stage 3 API route with the encoded URL", async () => {
    const fetchMock = vi.fn(async () => json(SUCCESS));
    vi.stubGlobal("fetch", fetchMock);
    render(<HomePage />);
    await submitUrl(FEED_URL);
    await screen.findByRole("heading", { name: "The Small Web Journal" });
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/feed?url=${encodeURIComponent(FEED_URL)}`,
      expect.objectContaining({ method: "GET" }),
    ]);
  });

  it("shows a loading state and disables the submit button", async () => {
    const { fetchMock, release } = deferredFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(<HomePage />);
    await submitUrl(FEED_URL);

    const button = screen.getByRole("button", { name: /Loading/ });
    expect(button).toHaveProperty("disabled", true);
    expect(screen.getByText("Loading feed…")).toBeTruthy();
    expect(screen.getByTestId("feed-skeleton")).toBeTruthy();

    release(json(SUCCESS));
    await screen.findByRole("heading", { name: "The Small Web Journal" });
    expect(screen.getByRole("button", { name: "Load feed" })).toHaveProperty("disabled", false);
    expect(screen.queryByTestId("feed-skeleton")).toBeNull();
  });

  it("shows the feed title, description and articles", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(SUCCESS)));
    render(<HomePage />);
    await submitUrl(FEED_URL);

    await screen.findByRole("heading", { name: "The Small Web Journal" });
    expect(screen.getByText("Essays about blogs and feeds.")).toBeTruthy();
    expect(screen.getByText("Loaded 2 articles from The Small Web Journal.")).toBeTruthy();
    expect(screen.getByText("2 articles")).toBeTruthy();

    const first = screen.getByRole("article", { name: "Why feeds still matter" });
    expect(within(first).getByText("Feeds let you follow writers directly.")).toBeTruthy();
    expect(within(first).getByText("by Meera Kaur")).toBeTruthy();
    expect(first.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-25T09:00:00.000Z");

    // Missing author/date: nothing is shown instead of "undefined".
    const second = screen.getByRole("article", { name: "A post without extras" });
    expect(second.querySelector("time")).toBeNull();
    expect(second.textContent).not.toMatch(/undefined|null|by\s*$/);
  });

  it("opens article links safely in a new tab", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(SUCCESS)));
    render(<HomePage />);
    await submitUrl(FEED_URL);

    const first = await screen.findByRole("article", { name: "Why feeds still matter" });
    const link = within(first).getByRole("link", { name: /Original/ });
    expect(link.getAttribute("href")).toBe("https://mock.example/feeds-matter");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("shows an empty state for a feed with no articles", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ...SUCCESS, items: [] })));
    render(<HomePage />);
    await submitUrl(FEED_URL);
    expect(await screen.findByText("This feed has no articles")).toBeTruthy();
    expect(screen.getByText("Loaded 0 articles from The Small Web Journal.")).toBeTruthy();
  });

  it("never renders feed text as HTML", async () => {
    const hostile = {
      ...SUCCESS,
      items: [{ id: "x", title: "<img src=x onerror=alert(1)>Title", url: "https://mock.example/x", summary: "<script>alert(1)</script>" }],
    };
    vi.stubGlobal("fetch", vi.fn(async () => json(hostile)));
    const { container } = render(<HomePage />);
    await submitUrl(FEED_URL);
    await screen.findByText("<img src=x onerror=alert(1)>Title");
    expect(container.querySelector("article img, article script")).toBeNull();
  });
});

describe("HomePage – errors and retry", () => {
  it("shows the server's error and lets the user retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ success: false, error: { code: "TIMEOUT", message: "The feed took too long to respond." } }, 504))
      .mockResolvedValueOnce(json(SUCCESS));
    vi.stubGlobal("fetch", fetchMock);
    render(<HomePage />);
    const user = await submitUrl(FEED_URL);

    expect((await screen.findByRole("alert")).textContent).toContain("The feed took too long to respond.");
    const retry = screen.getByRole("button", { name: "Try again" });

    await user.click(retry);
    await screen.findByRole("heading", { name: "The Small Web Journal" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(fetchMock.mock.calls[0][0]); // same URL retried
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("offers retry after a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    render(<HomePage />);
    await submitUrl(FEED_URL);
    expect((await screen.findByRole("alert")).textContent).toContain("Could not reach the NOVA Reader server");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("handles a non-JSON server reply", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>502</html>", { status: 502 })));
    render(<HomePage />);
    await submitUrl(FEED_URL);
    expect((await screen.findByRole("alert")).textContent).toContain("unexpected response (HTTP 502)");
  });

  it("does not offer retry for errors that will not change (e.g. blocked address)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      json({ success: false, error: { code: "BLOCKED_HOST", message: "This address is not allowed. Only public websites can be loaded." } }, 400),
    ));
    render(<HomePage />);
    await submitUrl("https://intranet.example/feed");
    expect((await screen.findByRole("alert")).textContent).toContain("This address is not allowed");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    // The user can still edit the URL and submit again.
    expect(screen.getByRole("button", { name: "Load feed" })).toHaveProperty("disabled", false);
  });

  it("keeps the previous feed visible when a new request fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(SUCCESS))
      .mockResolvedValueOnce(json({ success: false, error: { code: "INVALID_XML", message: "The feed is not valid XML." } }, 422));
    vi.stubGlobal("fetch", fetchMock);
    render(<HomePage />);
    await submitUrl(FEED_URL);
    await screen.findByRole("heading", { name: "The Small Web Journal" });

    await submitUrl("https://mock.example/broken.xml");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("The feed is not valid XML."));
    expect(screen.getByRole("heading", { name: "The Small Web Journal" })).toBeTruthy();
  });
});
