// Page-side controller for the local AI worker (Stage 7). Runs in the BROWSER.
//
// - Creates the worker only when load() is called (after the user's click).
// - Checks every message from the worker with Zod (protocol.ts).
// - cancel() terminates the worker immediately; that is the only reliable way
//   to stop a model in the middle of a step. The model must be loaded again
//   afterwards (from the browser cache, without a new download).

import { LOCAL_AI_MODEL, ORT_WASM_PATH_PREFIX, SUMMARY_TIMEOUT_MS, type AiDevice } from "./config";
import { aiErrorMessage, workerMessageSchema, type AiErrorCode, type WorkerMessage, type WorkerRequest } from "./protocol";
import { validateSummary } from "./text";

/** The parts of a Worker we use. Tests provide a fake. */
export type WorkerLike = {
  postMessage: (message: WorkerRequest) => void;
  terminate: () => void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

export type AiFailure = { ok: false; code: AiErrorCode; message: string };
export type LoadProgress = { loaded: number; total: number; progress: number };

function defaultCreateWorker(): WorkerLike {
  return new Worker(new URL("../../workers/ai.worker.ts", import.meta.url), { type: "module", name: "nova-local-ai" });
}

type Pending =
  | { kind: "load"; resolve: (r: { ok: true; device: AiDevice } | AiFailure) => void; onProgress: (p: LoadProgress) => void }
  | {
      kind: "summarize";
      requestId: number;
      resolve: (r: { ok: true; text: string } | AiFailure) => void;
      onProgress: (tokens: number) => void;
      timer: ReturnType<typeof setTimeout>;
    };

export class LocalAiClient {
  private worker: WorkerLike | null = null;
  private pending: Pending | null = null;
  private nextRequestId = 1;
  private readyDevice: AiDevice | null = null;

  constructor(
    private readonly createWorker: () => WorkerLike = defaultCreateWorker,
    private readonly summaryTimeoutMs: number = SUMMARY_TIMEOUT_MS,
  ) {}

  get isReady(): boolean {
    return this.readyDevice !== null;
  }

  /** Starts the worker and loads the model. Resolves when ready or failed. */
  load(device: AiDevice, onProgress: (progress: LoadProgress) => void): Promise<{ ok: true; device: AiDevice } | AiFailure> {
    this.cancel(); // never two loads at once
    const variant = LOCAL_AI_MODEL.variants[device];
    return new Promise((resolve) => {
      let worker: WorkerLike;
      try {
        worker = this.createWorker();
      } catch {
        resolve(failure("UNSUPPORTED"));
        return;
      }
      this.worker = worker;
      this.pending = { kind: "load", resolve, onProgress };
      worker.onmessage = (event) => this.handleMessage(event.data);
      worker.onerror = () => this.fail("WORKER_CRASHED");
      worker.postMessage({
        type: "load",
        modelId: LOCAL_AI_MODEL.id,
        task: LOCAL_AI_MODEL.task,
        device: variant.device,
        dtype: variant.dtype,
        wasmPathPrefix: ORT_WASM_PATH_PREFIX,
      });
    });
  }

  /** Summarizes already-prepared text. The result is validated before it is returned. */
  summarize(text: string, onProgress: (tokens: number) => void): Promise<{ ok: true; text: string } | AiFailure> {
    if (!this.worker || !this.readyDevice) return Promise.resolve(failure("MODEL_FAILED", "Local AI is not loaded."));
    if (this.pending) return Promise.resolve(failure("MODEL_FAILED", "Local AI is busy. Please wait or press Stop."));

    const requestId = this.nextRequestId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.fail("TIMEOUT"), this.summaryTimeoutMs);
      this.pending = { kind: "summarize", requestId, resolve, onProgress, timer };
      this.worker!.postMessage({ type: "summarize", requestId, text, maxNewTokens: LOCAL_AI_MODEL.maxNewTokens });
    });
  }

  /** Stops everything immediately (download or summary). The model must be loaded again. */
  cancel(): void {
    if (this.pending) this.settle(failure("CANCELLED"));
    this.stopWorker();
  }

  private handleMessage(data: unknown): void {
    const parsed = workerMessageSchema.safeParse(data);
    if (!parsed.success) {
      this.fail("INVALID_OUTPUT");
      return;
    }
    const message: WorkerMessage = parsed.data;
    const pending = this.pending;
    if (!pending) return;

    switch (message.type) {
      case "load-progress":
        if (pending.kind === "load") pending.onProgress(message);
        return;
      case "ready":
        if (pending.kind !== "load") return;
        this.readyDevice = message.device;
        this.settle({ ok: true, device: message.device });
        return;
      case "generate-progress":
        if (pending.kind === "summarize" && message.requestId === pending.requestId) pending.onProgress(message.tokens);
        return;
      case "summary": {
        if (pending.kind !== "summarize" || message.requestId !== pending.requestId) return;
        const checked = validateSummary(message.text);
        this.settle(checked.ok ? { ok: true, text: checked.text } : failure("INVALID_OUTPUT"));
        return;
      }
      case "error":
        if (pending.kind === "summarize" && message.requestId !== undefined && message.requestId !== pending.requestId) return;
        // After a load error or a memory error the worker's state is unreliable: stop it.
        if (pending.kind === "load" || message.code === "OUT_OF_MEMORY") {
          this.settle(failure(message.code));
          this.stopWorker();
        } else {
          this.settle(failure(message.code));
        }
        return;
    }
  }

  private fail(code: AiErrorCode): void {
    this.settle(failure(code));
    this.stopWorker();
  }

  private settle(result: Parameters<Pending["resolve"]>[0]): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    if (pending.kind === "summarize") clearTimeout(pending.timer);
    (pending.resolve as (r: typeof result) => void)(result);
  }

  private stopWorker(): void {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
    }
    this.worker = null;
    this.readyDevice = null;
  }
}

function failure(code: AiErrorCode, message = aiErrorMessage(code)): AiFailure {
  return { ok: false, code, message };
}

/** Deletes the downloaded model files from this browser (Cache Storage). */
export async function deleteDownloadedModel(cacheName: string): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  try {
    return await caches.delete(cacheName);
  } catch {
    return false;
  }
}
