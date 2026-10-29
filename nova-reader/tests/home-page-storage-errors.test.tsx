// @vitest-environment jsdom
// The page when local storage FAILS (storage full, or blocked by the browser).
// lib/db.ts is partly replaced with failing versions via vi.mock.
import "fake-indexeddb/auto";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";

const FULL = "Your browser's storage for this site is full. Remove some saved articles or clear offline copies.";

vi.mock("@/lib/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/db")>();
  const full = () => Promise.reject(new real.LocalStorageError(FULL, "QUOTA_EXCEEDED"));
  return { ...real, cacheFeed: vi.fn(full), saveArticle: vi.fn(full) };
});

const SUCCESS = {
  success: true,
  feed: { title: "Storage Test Blog", feedUrl: "https://mock.example/feed.xml" },
  items: [{ id: "s-1", title: "Keep me", url: "https://mock.example/keep", summary: "Text" }],
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(SUCCESS), { status: 200 })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HomePage – storage failures", () => {
  it("still shows the feed and explains that no offline copy was kept", async () => {
    render(<HomePage />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("RSS or Atom feed URL"), "https://mock.example/feed.xml{Enter}");

    expect(await screen.findByRole("heading", { name: "Storage Test Blog" })).toBeTruthy();
    expect(await screen.findByText(new RegExp(`Loaded 1 article from Storage Test Blog\\. An offline copy could not be kept: Your browser's storage`))).toBeTruthy();
  });

  it("shows a clear error when saving an article fails", async () => {
    render(<HomePage />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("RSS or Atom feed URL"), "https://mock.example/feed.xml{Enter}");
    const card = await screen.findByRole("article", { name: "Keep me" });
    await user.click(within(card).getByRole("button", { name: /^Save/ }));

    const savedSection = screen.getByRole("heading", { name: /Saved on this device/ }).closest("section")!;
    expect((await within(savedSection).findByRole("alert")).textContent).toBe(FULL);
    expect(within(card).getByRole("button", { name: /^Save/ }).getAttribute("aria-pressed")).toBe("false");
  });
});
