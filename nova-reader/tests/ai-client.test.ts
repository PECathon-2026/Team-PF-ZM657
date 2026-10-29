// Tests for lib/ai/local-ai-client.ts together with lib/ai/worker-logic.ts.
// A FakeWorker runs the REAL worker logic with a FAKE model, so the message
// protocol, progress, validation, cancellation and error handling are tested
// end to end — without downloading anything.
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalAiClient } from "@/lib/ai/local-ai-client";
import { GOOD_SUMMARY, setupFakeAi as setup } from "./helpers/fake-ai-worker";

const never = () => new Promise<never>(() => {});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LocalAiClient – loading", () => {
  it("does not create a worker until load() is called", () => {
    const { workers } = setup();
    expect(workers).toHaveLength(0);
  });

  it("loads the model, reporting download progress, then is ready", async () => {
    const { client, workers } = setup();
    const progress: number[] = [];
    const result = await client.load("wasm", (p) => progress.push(p.progress));

    expect(result).toEqual({ ok: true, device: "wasm" });
    expect(client.isReady).toBe(true);
    expect(progress).toEqual([50, 100]);
    expect(workers[0].received[0]).toEqual({
      type: "load",
      modelId: "Xenova/t5-small",
      task: "summarization",
      device: "wasm",
      dtype: "q8",
      wasmPathPrefix: "/ort/",
    });
  });

  it("uses fp16 on WebGPU", async () => {
    const { client, workers } = setup();
    await client.load("webgpu", () => {});
    expect(workers[0].received[0]).toMatchObject({ device: "webgpu", dtype: "fp16" });
  });

  it("reports download failures and stops the worker", async () => {
    const { client, workers } = setup({ load: async () => Promise.reject(new TypeError("Failed to fetch")) });
    const result = await client.load("wasm", () => {});
    expect(result).toMatchObject({ ok: false, code: "DOWNLOAD_FAILED" });
    expect(workers[0].terminated).toBe(true);
    expect(client.isReady).toBe(false);
  });

  it("reports WebGPU failures so the UI can offer CPU mode", async () => {
    const { client } = setup({ load: async () => Promise.reject(new Error("WebGPU: Unsupported data type")) });
    expect(await client.load("webgpu", () => {})).toMatchObject({ ok: false, code: "WEBGPU_FAILED" });
  });

  it("reports memory errors while loading", async () => {
    const { client } = setup({ load: async () => Promise.reject(new RangeError("Array buffer allocation failed")) });
    expect(await client.load("wasm", () => {})).toMatchObject({ ok: false, code: "OUT_OF_MEMORY" });
  });

  it("can cancel a download: the worker is terminated at once", async () => {
    const { client, workers } = setup({ load: never });
    const pending = client.load("wasm", () => {});
    await Promise.resolve();
    client.cancel();
    expect(await pending).toMatchObject({ ok: false, code: "CANCELLED" });
    expect(workers[0].terminated).toBe(true);
  });

  it("reports a crashed worker", async () => {
    const { client, workers } = setup({ load: never });
    const pending = client.load("wasm", () => {});
    workers[0].crash();
    expect(await pending).toMatchObject({ ok: false, code: "WORKER_CRASHED" });
    expect(workers[0].terminated).toBe(true);
  });

  it("reports when the worker cannot be created at all", async () => {
    const client = new LocalAiClient(() => {
      throw new Error("Worker blocked");
    });
    expect(await client.load("wasm", () => {})).toMatchObject({ ok: false, code: "UNSUPPORTED" });
  });
});

describe("LocalAiClient – summarizing", () => {
  it("returns a validated summary and reports token progress", async () => {
    const { client } = setup();
    await client.load("wasm", () => {});
    const tokens: number[] = [];
    const result = await client.summarize("summarize: some article", (t) => tokens.push(t));
    expect(result).toEqual({ ok: true, text: "Feeds let readers follow independent writers without tracking or ranking." });
    expect(tokens).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejects unusable AI output instead of showing it", async () => {
    const { client } = setup({ summarize: async () => "the the the the the the the the the the the the the the" });
    await client.load("wasm", () => {});
    expect(await client.summarize("summarize: x", () => {})).toMatchObject({ ok: false, code: "INVALID_OUTPUT" });
  });

  it("rejects malformed messages from the worker", async () => {
    const { client, workers } = setup({ summarize: never });
    await client.load("wasm", () => {});
    const pending = client.summarize("summarize: x", () => {});
    workers[0].emit({ type: "summary", requestId: 1, text: { not: "a string" } });
    expect(await pending).toMatchObject({ ok: false, code: "INVALID_OUTPUT" });
    expect(workers[0].terminated).toBe(true);
  });

  it("ignores results for an old request id", async () => {
    const { client, workers } = setup({ summarize: never });
    await client.load("wasm", () => {});
    const pending = client.summarize("summarize: x", () => {});
    workers[0].emit({ type: "summary", requestId: 999, text: GOOD_SUMMARY });
    client.cancel();
    expect(await pending).toMatchObject({ code: "CANCELLED" });
  });

  it("can cancel a running summary: the worker is terminated and must be loaded again", async () => {
    const { client, workers } = setup({ summarize: never });
    await client.load("wasm", () => {});
    const pending = client.summarize("summarize: x", () => {});
    client.cancel();
    expect(await pending).toMatchObject({ ok: false, code: "CANCELLED" });
    expect(workers[0].terminated).toBe(true);
    expect(client.isReady).toBe(false);
    expect(await client.summarize("summarize: x", () => {})).toMatchObject({ ok: false, code: "MODEL_FAILED" });
  });

  it("stops the worker after a memory error while summarizing", async () => {
    const { client, workers } = setup({ summarize: async () => Promise.reject(new Error("out of memory")) });
    await client.load("wasm", () => {});
    expect(await client.summarize("summarize: x", () => {})).toMatchObject({ ok: false, code: "OUT_OF_MEMORY" });
    expect(workers[0].terminated).toBe(true);
  });

  it("times out a summary that takes too long", async () => {
    const { client, workers } = setup({ summarize: never }, 30);
    await client.load("wasm", () => {});
    expect(await client.summarize("summarize: x", () => {})).toMatchObject({ ok: false, code: "TIMEOUT" });
    expect(workers[0].terminated).toBe(true);
  });

  it("refuses a second summary while one is running", async () => {
    const { client } = setup({ summarize: never });
    await client.load("wasm", () => {});
    void client.summarize("summarize: a", () => {});
    expect(await client.summarize("summarize: b", () => {})).toMatchObject({ ok: false, message: expect.stringMatching(/busy/) });
    client.cancel();
  });

  it("never sends article text over the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { client, workers } = setup();
    await client.load("wasm", () => {});
    await client.summarize("summarize: secret article text", () => {});
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(workers[0].received.map((m) => m.type)).toEqual(["load", "summarize"]); // text only goes to the worker
  });
});
