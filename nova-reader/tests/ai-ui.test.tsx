// @vitest-environment jsdom
// Tests for the Stage 7 UI: the Local AI panel (AIWorkspace) and the
// "Summarize locally" box (LocalSummary), with a fake model in a fake worker.
import "fake-indexeddb/auto";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Dexie from "dexie";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";
import { AIWorkspace } from "@/components/AIWorkspace";
import { LocalAiProvider } from "@/components/LocalAiProvider";
import { LocalSummary } from "@/components/LocalSummary";
import { ReaderView } from "@/components/ReaderView";
import type { LocalAiSupport } from "@/lib/ai/capabilities";
import { LocalAiClient } from "@/lib/ai/local-ai-client";
import { closeDatabase } from "@/lib/db";
import { FakeWorker, type FakeModel } from "./helpers/fake-ai-worker";

const WASM_SUPPORT: LocalAiSupport = {
  supported: true,
  device: "wasm",
  webgpu: { available: false, reason: "This browser does not support WebGPU." },
  approxDownloadMB: 80,
  lowMemory: false,
};
const WEBGPU_SUPPORT: LocalAiSupport = { ...WASM_SUPPORT, device: "webgpu", webgpu: { available: true }, approxDownloadMB: 156 };

const ARTICLE_TEXT =
  "Feeds let readers follow independent writers directly, without an algorithm deciding what they see. " +
  "Nothing about the reader is sent to a central company, and nobody ranks the posts. " +
  "The weak spot has always been discovery, which is why private, opt-in ideas matter.";

function renderWithAi(ui: React.ReactNode, { support = WASM_SUPPORT, model = {} as FakeModel } = {}) {
  const workers: FakeWorker[] = [];
  const createClient = vi.fn(
    () =>
      new LocalAiClient(() => {
        const worker = new FakeWorker(model);
        workers.push(worker);
        return worker;
      }),
  );
  const detect = vi.fn(async () => support);
  render(
    <LocalAiProvider detect={detect} createClient={createClient}>
      {ui}
    </LocalAiProvider>,
  );
  return { workers, createClient };
}

const panel = () => screen.getByRole("heading", { name: /Local AI/ }).closest("section")!;

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
  }
});

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

describe("Local AI panel", () => {
  it("explains when local AI is unsupported, and nothing else breaks", async () => {
    renderWithAi(<AIWorkspace />, { support: { supported: false, reason: "This browser does not support Web Workers, which local AI needs." } });
    expect(await within(panel()).findByText(/Local AI is not available: This browser does not support Web Workers/)).toBeTruthy();
    expect(within(panel()).getByText(/Everything else in NOVA Reader works normally/)).toBeTruthy();
    expect(within(panel()).queryByRole("button", { name: /Download/ })).toBeNull();
  });

  it("shows size, source and device BEFORE downloading, and creates no worker until clicked", async () => {
    const { createClient, workers } = renderWithAi(<AIWorkspace />);
    expect(await within(panel()).findByText(/80 MB/)).toBeTruthy();
    expect(within(panel()).getByText(/huggingface\.co/)).toBeTruthy();
    expect(within(panel()).getByText(/processor \(WebAssembly\)/)).toBeTruthy();
    expect(within(panel()).getByText(/This browser does not support WebGPU/)).toBeTruthy();
    expect(within(panel()).getByText(/Article text never leaves your device/)).toBeTruthy();
    expect(createClient).not.toHaveBeenCalled();
    expect(workers).toHaveLength(0);
  });

  it("downloads after the user's click, showing progress, then becomes ready", async () => {
    const { workers } = renderWithAi(<AIWorkspace />);
    const user = userEvent.setup();
    await user.click(await within(panel()).findByRole("button", { name: /Download & enable local AI/ }));

    expect(await within(panel()).findByText(/Downloading model… 40 MB of 80 MB \(50%\)/)).toBeTruthy();
    expect(within(panel()).getByRole("progressbar")).toBeTruthy();
    expect(await within(panel()).findByText(/Ready on the processor \(WebAssembly\)/)).toBeTruthy();
    expect(workers).toHaveLength(1);
  });

  it("lets the user cancel the download", async () => {
    const { workers } = renderWithAi(<AIWorkspace />, { model: { load: () => new Promise(() => {}) } });
    const user = userEvent.setup();
    await user.click(await within(panel()).findByRole("button", { name: /Download & enable/ }));
    await user.click(await within(panel()).findByRole("button", { name: "Cancel download" }));
    expect(await within(panel()).findByText("Download stopped.")).toBeTruthy();
    expect(workers[0].terminated).toBe(true);
    expect(within(panel()).getByRole("button", { name: /Download & enable/ })).toBeTruthy();
  });

  it("explains download failures and offers Try again", async () => {
    renderWithAi(<AIWorkspace />, { model: { load: () => Promise.reject(new TypeError("Failed to fetch")) } });
    const user = userEvent.setup();
    await user.click(await within(panel()).findByRole("button", { name: /Download & enable/ }));
    expect((await within(panel()).findByRole("alert")).textContent).toMatch(/could not be downloaded/);
    expect(within(panel()).getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("offers CPU mode when WebGPU fails", async () => {
    renderWithAi(<AIWorkspace />, { support: WEBGPU_SUPPORT, model: { load: () => Promise.reject(new Error("WebGPU device lost")) } });
    const user = userEvent.setup();
    expect(await within(panel()).findByText(/156 MB/)).toBeTruthy();
    await user.click(within(panel()).getByRole("button", { name: /Download & enable/ }));
    expect((await within(panel()).findByRole("alert")).textContent).toMatch(/graphics card/);
    expect(within(panel()).getByRole("button", { name: /Use CPU mode instead \(about 80 MB\)/ })).toBeTruthy();
  });

  it("explains memory errors", async () => {
    renderWithAi(<AIWorkspace />, { model: { load: () => Promise.reject(new RangeError("Array buffer allocation failed")) } });
    const user = userEvent.setup();
    await user.click(await within(panel()).findByRole("button", { name: /Download & enable/ }));
    expect((await within(panel()).findByRole("alert")).textContent).toMatch(/ran out of memory/);
  });

  it("deletes the downloaded model from Cache Storage", async () => {
    const deleteSpy = vi.fn(async () => true);
    vi.stubGlobal("caches", { delete: deleteSpy });
    renderWithAi(<AIWorkspace />);
    const user = userEvent.setup();
    await user.click(await within(panel()).findByRole("button", { name: /Download & enable/ }));
    await user.click(await within(panel()).findByRole("button", { name: /Delete downloaded model/ }));
    expect(deleteSpy).toHaveBeenCalledWith("transformers-cache");
    expect(await within(panel()).findByText(/downloaded model was deleted/)).toBeTruthy();
  });
});

describe("Summarize locally", () => {
  function SummaryWithPanel() {
    return (
      <>
        <AIWorkspace />
        <LocalSummary content={ARTICLE_TEXT} isHtml={false} />
      </>
    );
  }

  async function enableAi(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await within(panel()).findByRole("button", { name: /Download & enable/ }));
    await within(panel()).findByText(/Ready on/);
  }

  it("asks the user to turn on local AI first", async () => {
    renderWithAi(<SummaryWithPanel />);
    expect(await screen.findByText(/in the side panel to summarize articles on this device/)).toBeTruthy();
  });

  it("summarizes on the device, shows progress, and labels the result", async () => {
    let finish!: (text: string) => void;
    const model: FakeModel = {
      summarize: (_text, onToken) => {
        onToken();
        onToken();
        return new Promise((resolve) => (finish = resolve));
      },
    };
    const { workers } = renderWithAi(<SummaryWithPanel />, { model });
    const user = userEvent.setup();
    await enableAi(user);
    await user.click(screen.getByRole("button", { name: "Summarize locally" }));

    expect(await screen.findByText(/Writing summary… \d+%/)).toBeTruthy();
    const request = workers[0].received.find((m) => m.type === "summarize");
    expect(request && "text" in request && request.text.startsWith("summarize: Feeds let readers")).toBe(true);

    await act(async () => finish("feeds keep readers in control of what they read, without tracking."));
    expect(await screen.findByText("Feeds keep readers in control of what they read, without tracking.")).toBeTruthy();
    expect(screen.getByText(/Made on this device by a small AI model\. It may be incomplete or wrong/)).toBeTruthy();
  });

  it("shows AI output as plain text, never as HTML", async () => {
    const { workers } = renderWithAi(<SummaryWithPanel />, {
      model: { summarize: async () => 'readers <img src=x onerror="window.__ai=1"> control their feeds today.' },
    });
    const user = userEvent.setup();
    await enableAi(user);
    await user.click(screen.getByRole("button", { name: "Summarize locally" }));
    const summary = await screen.findByText("Readers control their feeds today.");
    expect(summary.closest("section")!.querySelector("img")).toBeNull();
    expect((window as Window & { __ai?: number }).__ai).toBeUndefined();
    expect(workers).toHaveLength(1);
  });

  it("can be stopped while running", async () => {
    const { workers } = renderWithAi(<SummaryWithPanel />, { model: { summarize: () => new Promise(() => {}) } });
    const user = userEvent.setup();
    await enableAi(user);
    await user.click(screen.getByRole("button", { name: "Summarize locally" }));
    await user.click(await screen.findByRole("button", { name: "Stop" }));
    expect(await screen.findByText("Stopped.")).toBeTruthy();
    expect(workers[0].terminated).toBe(true);
    expect(within(panel()).getByText(/Stopped\. Local AI was turned off/)).toBeTruthy();
  });

  it("does not show unusable output", async () => {
    renderWithAi(<SummaryWithPanel />, { model: { summarize: async () => "news news news news news news news news news news news news news" } });
    const user = userEvent.setup();
    await enableAi(user);
    await user.click(screen.getByRole("button", { name: "Summarize locally" }));
    expect(await screen.findByText(/unusable result, so it was not shown/)).toBeTruthy();
  });

  it("refuses text that is too short to summarize", async () => {
    renderWithAi(
      <>
        <AIWorkspace />
        <LocalSummary content="Too short." isHtml={false} />
      </>,
    );
    const user = userEvent.setup();
    await enableAi(user);
    await user.click(screen.getByRole("button", { name: "Summarize locally" }));
    expect(await screen.findByText(/not enough text in this article/)).toBeTruthy();
  });

  it("appears in the reading view once local AI is ready", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {}))); // full-article download stays pending
    renderWithAi(
      <>
        <AIWorkspace />
        <ReaderView
          article={{ id: "a1", title: "Feeds", url: "https://blog.example/a", summary: ARTICLE_TEXT, feedTitle: "Blog" }}
          onClose={() => {}}
        />
      </>,
    );
    const user = userEvent.setup();
    await enableAi(user);
    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(within(dialog).getByRole("button", { name: "Summarize locally" })).toBeTruthy();
  });
});

describe("Without local AI support", () => {
  it("the home page still works and shows why local AI is unavailable (jsdom has no Worker)", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<HomePage />);
    expect(await screen.findByText(/Local AI is not available: This browser does not support Web Workers/)).toBeTruthy();
    expect(screen.getByLabelText("RSS or Atom feed URL")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("No saved articles yet")).toBeTruthy());
  });
});
