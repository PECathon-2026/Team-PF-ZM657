// The AI Web Worker's logic, written without any Transformers.js import so it
// can be unit-tested with a fake model. workers/ai.worker.ts connects it to the
// real library. Runs inside the WORKER (never on the page's main thread).

import type { AiDevice } from "./config";
import { classifyAiError, aiErrorMessage, type WorkerMessage, type WorkerRequest } from "./protocol";

/** A loaded summarizer: text in, summary out, reporting each new token. */
export type Summarizer = (text: string, options: { maxNewTokens: number; onToken: () => void }) => Promise<string>;

export type LoadSummarizer = (options: {
  modelId: string;
  task: string;
  device: AiDevice;
  dtype: string;
  wasmPathPrefix: string;
  onProgress: (progress: { loaded: number; total: number; progress: number }) => void;
}) => Promise<Summarizer>;

/**
 * Returns the function to call for every message the worker receives.
 * `post` sends a message back to the page.
 */
export function createAiWorkerHandler(loadSummarizer: LoadSummarizer, post: (message: WorkerMessage) => void) {
  let summarizer: Summarizer | null = null;
  let device: AiDevice = "wasm";
  let lastProgressAt = 0;

  return async function handle(request: WorkerRequest): Promise<void> {
    if (request.type === "load") {
      device = request.device;
      try {
        summarizer = await loadSummarizer({
          modelId: request.modelId,
          task: request.task,
          device: request.device,
          dtype: request.dtype,
          wasmPathPrefix: request.wasmPathPrefix,
          onProgress: ({ loaded, total, progress }) => {
            // At most ~10 updates per second, plus the final 100 %.
            const now = Date.now();
            if (progress < 100 && now - lastProgressAt < 100) return;
            lastProgressAt = now;
            post({ type: "load-progress", loaded, total, progress: Math.min(100, Math.max(0, progress)) });
          },
        });
        post({ type: "ready", device });
      } catch (error) {
        summarizer = null;
        const code = classifyAiError(error, "load", device);
        post({ type: "error", code, message: aiErrorMessage(code) });
      }
      return;
    }

    if (request.type === "summarize") {
      if (!summarizer) {
        post({ type: "error", requestId: request.requestId, code: "MODEL_FAILED", message: "The model is not loaded yet." });
        return;
      }
      let tokens = 0;
      try {
        const text = await summarizer(request.text, {
          maxNewTokens: request.maxNewTokens,
          onToken: () => {
            tokens += 1;
            post({ type: "generate-progress", requestId: request.requestId, tokens });
          },
        });
        post({ type: "summary", requestId: request.requestId, text: String(text).slice(0, 20_000) });
      } catch (error) {
        const code = classifyAiError(error, "summarize", device);
        post({ type: "error", requestId: request.requestId, code, message: aiErrorMessage(code) });
      }
    }
  };
}
