// @vitest-environment jsdom
// Stage 9: error pages show safe messages, offer recovery, and never leak details.
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import RouteError from "@/app/error";
import NotFound from "@/app/not-found";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("app/error.tsx", () => {
  it("shows a friendly message, a Try again button and a way back — never the raw error", async () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    const error = Object.assign(new Error("ENOENT /srv/app/.env SECRET_KEY=abc https://x.example/?token=t0k3n"), { digest: "123456" });
    const { container } = render(<RouteError error={error} retry={retry} />);

    expect(screen.getByRole("heading", { name: "This page could not be shown" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Something went wrong. Please try again.");
    expect(container.textContent).not.toMatch(/ENOENT|srv|SECRET|t0k3n/);
    expect(screen.getByText("Reference: 123456")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to the reader" }).getAttribute("href")).toBe("/");

    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);

    const logged = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).not.toMatch(/SECRET_KEY=abc|t0k3n|\/srv\/app/);
  });

  it("explains network errors (for example a failed code download while offline)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<RouteError error={Object.assign(new Error("Loading chunk 7 failed"), { name: "ChunkLoadError" })} retry={() => {}} />);
    expect(screen.getByRole("alert").textContent).toMatch(/Check your internet connection/);
  });
});

describe("app/not-found.tsx", () => {
  it("has a main landmark, a heading and links back", () => {
    render(<NotFound />);
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to the reader" }).getAttribute("href")).toBe("/");
  });
});
