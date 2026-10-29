// The local AI Web Worker (Stage 7). Runs in a separate browser thread, so long
// AI work never freezes the page. Started only after the user enables local AI.
//
// Privacy: the only network requests made here are downloads of the model files
// (from huggingface.co, cached in Cache Storage) and the ONNX Runtime engine
// (from our own /ort/ folder). Article text is processed here and only sent
// back to the page — never to any server.

/// <reference lib="webworker" />

import { env, pipeline, TextStreamer, type ProgressInfo } from "@huggingface/transformers";
import { createAiWorkerHandler, type LoadSummarizer } from "@/lib/ai/worker-logic";
import type { WorkerRequest } from "@/lib/ai/protocol";

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
    const streamer = new TextStreamer(pipe.tokenizer, { skip_prompt: true, callback_function: () => onToken() });
    const output = await pipe(text, { max_new_tokens: maxNewTokens, streamer });
    const first = Array.isArray(output) ? output[0] : output;
    return typeof first === "object" && first && "summary_text" in first ? String(first.summary_text) : "";
  };
};

/**
 * Transformers.js points ONNX Runtime at cdn.jsdelivr.net by default. We keep the
 * file variant it chose but load it from our own site instead.
 */
function pointWasmToOwnSite(prefix: string) {
  const wasm = env.backends.onnx.wasm;
  if (!wasm) return;
  const current = wasm.wasmPaths;
  if (current && typeof current === "object") {
    const file = (url: string | URL | undefined) => (url ? String(url).split("/").pop() : undefined);
    const mjs = file(current.mjs);
    const binary = file(current.wasm);
    if (mjs && binary) wasm.wasmPaths = { mjs: `${prefix}${mjs}`, wasm: `${prefix}${binary}` };
  } else {
    wasm.wasmPaths = prefix;
  }
}

const handle = createAiWorkerHandler(loadSummarizer, (message) => self.postMessage(message));

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  void handle(event.data);
});
