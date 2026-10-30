// The local AI Web Worker (Stage 7). Runs in a separate browser thread, so long
// AI work never freezes the page. Started only after the user enables local AI.
//
// Privacy: the only network requests made here are downloads of the model files
// (from huggingface.co, cached in Cache Storage) and the ONNX Runtime engine
// (from our own /ort/ folder). Article text is processed here and only sent
// back to the page — never to any server.

/// <reference lib="webworker" />

import { env, pipeline, TextStreamer, type ProgressInfo } from "@huggingface/transformers";
import { validateSummary } from "@/lib/ai/text";
import { createAiWorkerHandler, type LoadSummarizer } from "@/lib/ai/worker-logic";
import type { WorkerRequest } from "@/lib/ai/protocol";
import { buildExtractiveSummary } from "@/lib/extractive-summary";

env.allowLocalModels = false; // models come only from the Hub (no guessing local paths)
env.useBrowserCache = true; // keep downloaded files in Cache Storage

const loadSummarizer: LoadSummarizer = async ({ modelId, task, device, dtype, wasmPathPrefix, onProgress }) => {
  pointWasmToOwnSite(wasmPathPrefix);

  const pipe = await pipeline(task as "summarization", modelId, {
    device,
    dtype: dtype as "q8" | "fp16",
    progress_callback: (info: ProgressInfo) => {
      if (info.status === "progress_total") onProgress({ loaded: info.loaded, total: info.total, progress: info.progress });
    },
  });

  return async (text, { maxNewTokens, onToken }) => {
    // SummarizationPipeline in Transformers.js v4 automatically prepends
    // `task_specific_params.summarization.prefix` ("summarize: "). Strip ours first
    // so T5 does not receive "summarize: summarize: ...".
    const cleanInput = text.replace(/^summarize:\s*/i, "");
    const streamer = new TextStreamer(pipe.tokenizer, { skip_prompt: true, callback_function: () => onToken() });
    const output = await pipe(cleanInput, {
      max_new_tokens: maxNewTokens,
      min_new_tokens: 18,
      no_repeat_ngram_size: 3,
      repetition_penalty: 1.25,
      streamer,
    });
    const first = Array.isArray(output) ? output[0] : output;
    const raw =
      typeof first === "object" && first && "summary_text" in first
        ? String(first.summary_text)
        : typeof first === "object" && first && "generated_text" in first
          ? String((first as { generated_text: unknown }).generated_text)
          : "";

    const checked = validateSummary(raw);
    if (checked.ok) return checked.text;

    // Fallback to deterministic extractive summary if small T5 output is empty or repetitive.
    const extractive = buildExtractiveSummary(cleanInput, false, 3);
    return extractive.ok ? extractive.text : raw;
  };
};

/**
 * Resolves `/ort/` against the application origin even inside `blob:` workers,
 * and uses single-threaded WASM when the page is not cross-origin isolated.
 */
function resolveOriginPrefix(prefix: string): string {
  if (/^https?:\/\//i.test(prefix)) return prefix;
  let origin = "";
  if (typeof self !== "undefined" && self.location) {
    if (self.location.origin && self.location.origin !== "null") {
      origin = self.location.origin;
    } else if (self.location.href?.startsWith("blob:")) {
      try {
        origin = new URL(self.location.href.slice(5)).origin;
      } catch {
        origin = "";
      }
    }
  }
  const normalized = prefix.startsWith("/") ? prefix : `/${prefix}`;
  return origin ? `${origin}${normalized}` : normalized;
}

function pointWasmToOwnSite(prefix: string) {
  const wasm = env.backends.onnx.wasm;
  if (!wasm) return;
  const absPrefix = resolveOriginPrefix(prefix);
  const current = wasm.wasmPaths;
  if (current && typeof current === "object") {
    const file = (url: string | URL | undefined) => (url ? String(url).split("/").pop() : undefined);
    const mjs = file(current.mjs) ?? "ort-wasm-simd-threaded.asyncify.mjs";
    const binary = file(current.wasm) ?? "ort-wasm-simd-threaded.asyncify.wasm";
    wasm.wasmPaths = { mjs: `${absPrefix}${mjs}`, wasm: `${absPrefix}${binary}` };
  } else {
    wasm.wasmPaths = {
      mjs: `${absPrefix}ort-wasm-simd-threaded.asyncify.mjs`,
      wasm: `${absPrefix}ort-wasm-simd-threaded.asyncify.wasm`,
    };
  }
  wasm.proxy = false;
  if (typeof self !== "undefined" && !self.crossOriginIsolated) {
    wasm.numThreads = 1;
  }
}

const handle = createAiWorkerHandler(loadSummarizer, (message) => self.postMessage(message));

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  void handle(event.data);
});
