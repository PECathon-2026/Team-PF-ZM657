// @vitest-environment jsdom
// Tests for the /radar page (Stage 8): real IndexedDB behaviour via fake-indexeddb.
import "fake-indexeddb/auto";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RadarPage from "@/app/radar/page";
import { cacheFeed, closeDatabase, saveArticle, storeExtractedArticle } from "@/lib/db";

const section = (name: string) => screen.getByRole("region", { name });

async function seed() {
  await cacheFeed(
    "https://blog.example/feed.xml",
    { title: "Example Blog", feedUrl: "https://blog.example/feed.xml" },
    [
      { id: "1", title: "Privacy first", url: "https://blog.example/1", summary: "", categories: ["Privacy"] },
      { id: "2", title: "Private search", url: "https://blog.example/2", summary: "", categories: ["Privacy"] },
    ],
  );
  await saveArticle({ id: "1", title: "Privacy first", url: "https://blog.example/1", summary: "Notes on feeds" }, "Example Blog");
  await saveArticle({ id: "2", title: "Private search", url: "https://blog.example/2", summary: "More notes on feeds" }, "Example Blog");
  await saveArticle({ id: "3", title: "Monsoon gardening", url: "https://garden.example/3", summary: "" }, "Garden Notes");
  await storeExtractedArticle({
    url: "https://blog.example/1",
    pageUrl: "https://blog.example/1",
    lang: "en",
    contentHtml: `<p>${"word ".repeat(1000)}</p>`,
    textLength: 5000,
    extractedAt: new Date().toISOString(),
  });
}

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  closeDatabase();
  await Dexie.delete("nova-reader");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("/radar page", () => {
  it("shows an empty state when nothing is stored", async () => {
    render(<RadarPage />);
    expect(await screen.findByText("Nothing to show yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to the reader" }).getAttribute("href")).toBe("/");
  });

  it("summarizes the data stored on this device", async () => {
    await seed();
    render(<RadarPage />);
    const summary = await screen.findByRole("region", { name: "Summary" });
    expect(within(summary).getByText("Saved articles").nextSibling?.textContent).toBe("3");
    expect(within(summary).getByText("Sources you saved from").nextSibling?.textContent).toBe("2");
    expect(within(summary).getByText("Full articles stored").nextSibling?.textContent).toBe("1");
    expect(within(summary).getByText("5 min")).toBeTruthy(); // 1,000 words at 200 per minute

    const topics = section("Topics in your saved articles");
    expect(within(topics).getByLabelText("Privacy: 2 articles (category)")).toBeTruthy();

    const sources = section("Where your saved articles come from");
    expect(within(sources).getByLabelText("Example Blog: 2 articles")).toBeTruthy();
    expect(within(sources).getByLabelText("Garden Notes: 1 article")).toBeTruthy();

    expect(within(section("Languages of stored full articles")).getByLabelText("English: 1 article")).toBeTruthy();
    expect(within(section("Articles saved per week")).getByRole("img", { name: /Articles saved per week, last 8 weeks/ })).toBeTruthy();
  });

  it("is honest about what it cannot see", async () => {
    await seed();
    render(<RadarPage />);
    const card = await screen.findByRole("region", { name: "What the radar cannot see" });
    expect(card.textContent).toMatch(/Local AI summaries/);
    expect(card.textContent).toMatch(/Reading time and a history of opened articles/);
    expect(card.textContent).toMatch(/Feed categories for saved articles whose feed is no longer cached/); // the garden article
  });

  it("shows a tooltip on keyboard focus and has a table view for every chart", async () => {
    await seed();
    render(<RadarPage />);
    const user = userEvent.setup();
    const sources = await screen.findByRole("region", { name: "Where your saved articles come from" });
    within(sources).getByLabelText("Example Blog: 2 articles").focus();
    expect((await within(sources).findByRole("tooltip")).textContent).toBe("2 articles Example Blog");

    await user.click(within(sources).getByText("Show as table"));
    const table = within(sources).getByRole("table");
    expect(within(table).getByRole("rowheader", { name: "Example Blog" })).toBeTruthy();
    expect(screen.getAllByText("Show as table").length).toBeGreaterThanOrEqual(3);
  });

  it("refreshes from the database on request", async () => {
    render(<RadarPage />);
    await screen.findByText("Nothing to show yet");
    await saveArticle({ id: "9", title: "Brand new", url: "https://new.example/9", summary: "" }, "New Blog");
    await userEvent.setup().click(screen.getByRole("button", { name: "Refresh" }));
    const summary = await screen.findByRole("region", { name: "Summary" });
    expect(within(summary).getByText("Saved articles").nextSibling?.textContent).toBe("1");
  });

  it("never uses the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await seed();
    render(<RadarPage />);
    await screen.findByRole("region", { name: "Summary" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("explains when local storage is unavailable", async () => {
    closeDatabase();
    vi.stubGlobal("indexedDB", undefined);
    render(<RadarPage />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Local storage is not available/));
  });
});
