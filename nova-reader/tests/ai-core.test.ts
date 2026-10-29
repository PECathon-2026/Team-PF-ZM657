// Tests for the local AI building blocks (Stage 7): capability detection,
// input preparation, output validation and error classification. No model needed.
import { describe, expect, it } from "vitest";
import { detectLocalAiSupport, type CapabilityEnvironment } from "@/lib/ai/capabilities";
import { LOCAL_AI_MODEL } from "@/lib/ai/config";
import { classifyAiError, workerMessageSchema } from "@/lib/ai/protocol";
import { prepareSummaryInput, validateSummary } from "@/lib/ai/text";

const adapter = (features: string[]) => ({ features: new Set(features) });
const env = (overrides: Partial<CapabilityEnvironment> = {}): CapabilityEnvironment => ({
  hasWorker: true,
  hasWebAssembly: true,
  isSecureContext: true,
  gpu: { requestAdapter: async () => adapter(["shader-f16"]) },
  ...overrides,
});

describe("detectLocalAiSupport", () => {
  it("uses WebGPU when it is fully available", async () => {
    expect(await detectLocalAiSupport(env())).toEqual({
      supported: true,
      device: "webgpu",
      webgpu: { available: true },
      approxDownloadMB: LOCAL_AI_MODEL.variants.webgpu.approxDownloadMB,
      lowMemory: false,
    });
  });

  it.each([
    ["no secure context", { isSecureContext: false }, /HTTPS/],
    ["no navigator.gpu", { gpu: undefined }, /does not support WebGPU/],
    ["no adapter", { gpu: { requestAdapter: async () => null } }, /No compatible graphics adapter/],
    ["no shader-f16", { gpu: { requestAdapter: async () => adapter([]) } }, /16-bit/],
    [
      "requestAdapter throws",
      {
        gpu: {
          requestAdapter: async () => {
            throw new Error("boom");
          },
        },
      },
      /could not be started/,
    ],
  ])("falls back to WebAssembly when WebGPU has a problem: %s", async (_label, overrides, reason) => {
    const support = await detectLocalAiSupport(env(overrides as Partial<CapabilityEnvironment>));
    expect(support).toMatchObject({ supported: true, device: "wasm", webgpu: { available: false } });
    if (support.supported) {
      expect(support.webgpu.reason).toMatch(reason);
      expect(support.approxDownloadMB).toBe(LOCAL_AI_MODEL.variants.wasm.approxDownloadMB);
    }
  });

  it("does not hang if the GPU never answers", async () => {
    const support = await detectLocalAiSupport(env({ gpu: { requestAdapter: () => new Promise(() => {}) } }), 20);
    expect(support).toMatchObject({ supported: true, device: "wasm" });
  });

  it("is unsupported without Web Workers or WebAssembly", async () => {
    expect(await detectLocalAiSupport(env({ hasWorker: false }))).toMatchObject({ supported: false, reason: expect.stringMatching(/Web Workers/) });
    expect(await detectLocalAiSupport(env({ hasWebAssembly: false }))).toMatchObject({ supported: false, reason: expect.stringMatching(/WebAssembly/) });
  });

  it("warns on low-memory devices", async () => {
    expect(await detectLocalAiSupport(env({ deviceMemoryGB: 2 }))).toMatchObject({ lowMemory: true });
    expect(await detectLocalAiSupport(env({ deviceMemoryGB: 8 }))).toMatchObject({ lowMemory: false });
  });

  it("works in the current (non-browser) environment without throwing", async () => {
    await expect(detectLocalAiSupport()).resolves.toMatchObject({ supported: false });
  });
});

describe("prepareSummaryInput", () => {
  const sentence = "Feeds let people follow independent writers without an algorithm deciding what they see. ";

  it("adds the task prefix and strips HTML", () => {
    const result = prepareSummaryInput(`<p>${sentence.repeat(4)}</p><script>x()</script>`, true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text.startsWith("summarize: Feeds let people")).toBe(true);
      expect(result.text).not.toMatch(/<|script|x\(\)/);
      expect(result.truncated).toBe(false);
    }
  });

  it("cuts long text at a sentence end within the model limit", () => {
    const result = prepareSummaryInput(sentence.repeat(60), false);
    if (!result.ok) throw new Error("expected ok");
    expect(result.truncated).toBe(true);
    const body = result.text.slice(LOCAL_AI_MODEL.inputPrefix.length);
    expect(body.length).toBeLessThanOrEqual(LOCAL_AI_MODEL.maxInputChars);
    expect(body.endsWith(".")).toBe(true);
  });

  it("refuses text that is too short", () => {
    expect(prepareSummaryInput("Too short.", false)).toEqual({ ok: false });
  });
});

describe("validateSummary", () => {
  it("accepts normal text, cleans it and capitalizes the first letter", () => {
    expect(validateSummary("  feeds let readers   follow writers directly.\n")).toEqual({
      ok: true,
      text: "Feeds let readers follow writers directly.",
    });
  });

  it("removes markup and control characters (output is always plain text)", () => {
    const result = validateSummary('Feeds are <img src=x onerror="alert(1)">useful\u0007 for readers today.');
    expect(result).toEqual({ ok: true, text: "Feeds are useful for readers today." });
  });

  it.each([
    ["not a string", 42],
    ["empty", "   "],
    ["too short", "ok."],
    ["too long", "word ".repeat(400)],
    ["mostly symbols", "!!!! ???? 1234 5678 #### $$$$ %%%%"],
    ["repetition loop", "the feed is the feed is the feed is the feed is the feed is great"],
    ["low variety", "news news news news news news news news news news news news news"],
  ])("rejects bad output: %s", (_label, value) => {
    expect(validateSummary(value).ok).toBe(false);
  });
});

describe("classifyAiError", () => {
  it.each([
    [new RangeError("Array buffer allocation failed"), "load", "wasm", "OUT_OF_MEMORY"],
    [new Error("Aborted(). Build with -sASSERTIONS for more info. out of memory"), "summarize", "wasm", "OUT_OF_MEMORY"],
    [new TypeError("Failed to fetch"), "load", "wasm", "DOWNLOAD_FAILED"],
    [new Error("Could not locate file: onnx/encoder_model_quantized.onnx"), "load", "wasm", "DOWNLOAD_FAILED"],
    [new Error("GPU device was lost"), "summarize", "webgpu", "WEBGPU_FAILED"],
    [new Error("Unsupported data type"), "load", "webgpu", "WEBGPU_FAILED"],
    [new Error("weird"), "summarize", "wasm", "MODEL_FAILED"],
  ] as const)("%s → %s", (error, phase, device, code) => {
    expect(classifyAiError(error, phase, device)).toBe(code);
  });
});

describe("workerMessageSchema", () => {
  it("accepts valid messages and rejects unexpected ones", () => {
    expect(workerMessageSchema.safeParse({ type: "ready", device: "wasm" }).success).toBe(true);
    expect(workerMessageSchema.safeParse({ type: "summary", requestId: 1, text: "Hi" }).success).toBe(true);
    expect(workerMessageSchema.safeParse({ type: "ready", device: "cloud" }).success).toBe(false);
    expect(workerMessageSchema.safeParse({ type: "load-progress", loaded: 1, total: 2, progress: 500 }).success).toBe(false);
    expect(workerMessageSchema.safeParse({ type: "error", code: "HACKED", message: "x" }).success).toBe(false);
    expect(workerMessageSchema.safeParse({ type: "summary", requestId: 1, text: { html: "<b>" } }).success).toBe(false);
  });
});
