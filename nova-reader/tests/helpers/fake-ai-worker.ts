// A fake AI Web Worker for tests: runs the REAL worker logic (lib/ai/worker-logic.ts)
// with a FAKE model, so nothing is downloaded.
import { LocalAiClient, type WorkerLike } from "@/lib/ai/local-ai-client";
import type { WorkerRequest } from "@/lib/ai/protocol";
import { createAiWorkerHandler, type LoadSummarizer } from "@/lib/ai/worker-logic";

export type FakeModel = {
  load?: (onProgress: (p: { loaded: number; total: number; progress: number }) => void) => Promise<void>;
  summarize?: (text: string, onToken: () => void) => Promise<string>;
};

export const GOOD_SUMMARY = "feeds let readers follow independent writers without tracking or ranking.";

export class FakeWorker implements WorkerLike {
  onmessage: WorkerLike["onmessage"] = null;
  onerror: WorkerLike["onerror"] = null;
  terminated = false;
  received: WorkerRequest[] = [];
  private handle: (request: WorkerRequest) => Promise<void>;

  constructor(model: FakeModel) {
    const loadSummarizer: LoadSummarizer = async ({ onProgress }) => {
      await (model.load ?? defaultLoad)(onProgress);
      return async (text, { onToken }) => (model.summarize ?? defaultSummarize)(text, onToken);
    };
    this.handle = createAiWorkerHandler(loadSummarizer, (message) => this.emit(message));
  }

  postMessage(request: WorkerRequest) {
    this.received.push(request);
    queueMicrotask(() => void this.handle(request));
  }
  terminate() {
    this.terminated = true;
  }
  emit(data: unknown) {
    if (!this.terminated) this.onmessage?.({ data } as MessageEvent<unknown>);
  }
  crash() {
    this.onerror?.(new Event("error") as ErrorEvent); // Node has no ErrorEvent; the client only needs the event
  }
}

async function defaultLoad(onProgress: (p: { loaded: number; total: number; progress: number }) => void) {
  onProgress({ loaded: 40_000_000, total: 80_000_000, progress: 50 });
  await new Promise((r) => setTimeout(r, 120)); // let the progress throttle pass
  onProgress({ loaded: 80_000_000, total: 80_000_000, progress: 100 });
}

async function defaultSummarize(_text: string, onToken: () => void) {
  for (let i = 0; i < 5; i++) onToken();
  return GOOD_SUMMARY;
}

export function setupFakeAi(model: FakeModel = {}, timeoutMs?: number) {
  const workers: FakeWorker[] = [];
  const client = new LocalAiClient(() => {
    const worker = new FakeWorker(model);
    workers.push(worker);
    return worker;
  }, timeoutMs);
  return { client, workers };
}

