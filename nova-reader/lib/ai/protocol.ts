// Messages between the page and the AI Web Worker (Stage 7). Runs on BOTH sides.
// Every message coming FROM the worker is checked with Zod before it is used,
// so a buggy or unexpected worker can never inject unchecked data into the UI.

import "@/lib/zod-setup"; // CSP-safe Zod settings (no eval), also inside the worker
import * as z from "zod";
import type { AiDevice } from "./config";

export const AI_ERROR_CODES = [
  "UNSUPPORTED",
  "DOWNLOAD_FAILED",
  "OUT_OF_MEMORY",
  "WEBGPU_FAILED",
  "MODEL_FAILED",
  "INVALID_OUTPUT",
  "INPUT_TOO_SHORT",
  "WORKER_CRASHED",
  "TIMEOUT",
  "CANCELLED",
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

// --- Page → worker ------------------------------------------------------------

export type LoadRequest = {
  type: "load";
  modelId: string;
  task: string;
  device: AiDevice;
  dtype: string;
  wasmPathPrefix: string;
};

export type SummarizeRequest = {
  type: "summarize";
  requestId: number;
  text: string; // already prepared (prefix, length limit)
  maxNewTokens: number;
};

export type WorkerRequest = LoadRequest | SummarizeRequest;

// --- Worker → page --------------------------------------------------------------

const finite = z.number().refine(Number.isFinite);

export const workerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("load-progress"), loaded: finite.min(0), total: finite.min(0), progress: finite.min(0).max(100) }),
  z.object({ type: z.literal("ready"), device: z.enum(["webgpu", "wasm"]) }),
  z.object({ type: z.literal("generate-progress"), requestId: z.number().int(), tokens: z.number().int().min(0) }),
  z.object({ type: z.literal("summary"), requestId: z.number().int(), text: z.string().max(20_000) }),
  z.object({
    type: z.literal("error"),
    requestId: z.number().int().optional(),
    code: z.enum(AI_ERROR_CODES),
    message: z.string().max(500),
  }),
]);

export type WorkerMessage = z.infer<typeof workerMessageSchema>;

// --- Error classification ---------------------------------------------------------

const MESSAGES: Record<AiErrorCode, string> = {
  UNSUPPORTED: "Local AI is not supported in this browser.",
  DOWNLOAD_FAILED: "The AI model could not be downloaded. Check your connection and try again.",
  OUT_OF_MEMORY: "This device ran out of memory for local AI. Close other tabs or apps and try again, or use CPU mode.",
  WEBGPU_FAILED: "The graphics card (WebGPU) could not run the model. You can use CPU mode instead.",
  MODEL_FAILED: "The local AI model stopped with an error. Please try again.",
  INVALID_OUTPUT: "The AI produced an unusable result, so it was not shown.",
  INPUT_TOO_SHORT: "There is not enough text in this article to summarize.",
  WORKER_CRASHED: "The local AI process stopped unexpectedly. Please try again.",
  TIMEOUT: "Summarizing took too long and was stopped.",
  CANCELLED: "Stopped.",
};

export function aiErrorMessage(code: AiErrorCode): string {
  return MESSAGES[code];
}

/**
 * Turns any error thrown inside the worker into a safe code + message.
 * Raw error text (which may include file paths or internals) is never shown.
 */
export function classifyAiError(error: unknown, phase: "load" | "summarize", device: AiDevice): AiErrorCode {
  const text = String(error instanceof Error ? `${error.name} ${error.message}` : error);
  if (/out of memory|\boom\b|allocation failed|array buffer allocation|memory access out of bounds|could not allocate|RangeError/i.test(text)) {
    return "OUT_OF_MEMORY";
  }
  if (phase === "load" && /fetch|network|failed to load|could not locate file|404|403|timed? ?out|ERR_/i.test(text)) {
    return "DOWNLOAD_FAILED";
  }
  if (device === "webgpu" && /webgpu|gpu|adapter|device (was )?lost|shader/i.test(text)) return "WEBGPU_FAILED";
  if (phase === "load" && device === "webgpu") return "WEBGPU_FAILED";
  return "MODEL_FAILED";
}
