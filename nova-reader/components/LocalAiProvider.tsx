"use client";
// Shares ONE local AI state (and one worker) between the sidebar panel and the
// reader. Runs in the BROWSER.
//
// Nothing is downloaded and no worker is created until the user calls enable().

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { detectLocalAiSupport, type LocalAiSupport } from "@/lib/ai/capabilities";
import { MODEL_CACHE_NAME, type AiDevice } from "@/lib/ai/config";
import { deleteDownloadedModel, LocalAiClient, type AiFailure, type LoadProgress } from "@/lib/ai/local-ai-client";
import { aiErrorMessage, type AiErrorCode } from "@/lib/ai/protocol";
import { prepareSummaryInput } from "@/lib/ai/text";

type Supported = Extract<LocalAiSupport, { supported: true }>;

export type LocalAiStatus =
  | { phase: "checking" }
  | { phase: "unsupported"; reason: string }
  | { phase: "idle"; support: Supported; notice?: string }
  | { phase: "loading"; support: Supported; device: AiDevice; progress: LoadProgress | null }
  | { phase: "ready"; support: Supported; device: AiDevice; busy: boolean }
  | { phase: "error"; support: Supported; device: AiDevice; code: AiErrorCode; message: string };

export type SummaryResult = { ok: true; text: string; truncated: boolean } | AiFailure;

type LocalAiContextValue = {
  status: LocalAiStatus;
  enable: (device?: AiDevice) => void;
  cancel: () => void;
  unload: () => void;
  deleteModel: () => Promise<void>;
  summarize: (content: string, isHtml: boolean, onTokens: (tokens: number) => void) => Promise<SummaryResult>;
};

const NOT_AVAILABLE: LocalAiContextValue = {
  status: { phase: "unsupported", reason: "Local AI is not available here." },
  enable: () => {},
  cancel: () => {},
  unload: () => {},
  deleteModel: async () => {},
  summarize: async () => ({ ok: false, code: "UNSUPPORTED", message: aiErrorMessage("UNSUPPORTED") }),
};

const LocalAiContext = createContext<LocalAiContextValue>(NOT_AVAILABLE);

/** Use the shared local AI state. Without a provider, local AI is simply "not available". */
export function useLocalAi(): LocalAiContextValue {
  return useContext(LocalAiContext);
}

type ProviderProps = {
  children: ReactNode;
  detect?: () => Promise<LocalAiSupport>; // tests pass fakes
  createClient?: () => LocalAiClient;
};

export function LocalAiProvider({ children, detect = detectLocalAiSupport, createClient }: ProviderProps) {
  const [status, setStatus] = useState<LocalAiStatus>({ phase: "checking" });
  const clientRef = useRef<LocalAiClient | null>(null);

  // Feature detection only — no download, no worker.
  useEffect(() => {
    let active = true;
    detect()
      .then((support) => {
        if (!active) return;
        setStatus(support.supported ? { phase: "idle", support } : { phase: "unsupported", reason: support.reason });
      })
      .catch(() => active && setStatus({ phase: "unsupported", reason: "Local AI support could not be checked." }));
    return () => {
      active = false;
      clientRef.current?.cancel(); // leaving the page stops the worker
    };
  }, [detect]);

  const supportOf = (s: LocalAiStatus): Supported | null => ("support" in s ? s.support : null);

  function client(): LocalAiClient {
    clientRef.current ??= createClient ? createClient() : new LocalAiClient();
    return clientRef.current;
  }

  function enable(device?: AiDevice) {
    const support = supportOf(status);
    if (!support) return;
    const chosen = device ?? support.device;
    setStatus({ phase: "loading", support, device: chosen, progress: null });
    client()
      .load(chosen, (progress) =>
        setStatus((current) => (current.phase === "loading" ? { ...current, progress } : current)),
      )
      .then((result) => {
        setStatus((current) => {
          if (current.phase !== "loading") return current; // cancelled meanwhile
          if (result.ok) return { phase: "ready", support, device: result.device, busy: false };
          if (result.code === "CANCELLED") return { phase: "idle", support, notice: "Download stopped." };
          return { phase: "error", support, device: chosen, code: result.code, message: result.message };
        });
      });
  }

  function cancel() {
    const support = supportOf(status);
    clientRef.current?.cancel();
    if (support) {
      setStatus({
        phase: "idle",
        support,
        notice:
          status.phase === "loading"
            ? "Download stopped."
            : "Stopped. Local AI was turned off; enable it again to continue (it loads from this device).",
      });
    }
  }

  function unload() {
    const support = supportOf(status);
    clientRef.current?.cancel();
    if (support) setStatus({ phase: "idle", support, notice: "Local AI was turned off to free memory." });
  }

  async function deleteModel() {
    const support = supportOf(status);
    clientRef.current?.cancel();
    const deleted = await deleteDownloadedModel(MODEL_CACHE_NAME);
    if (support) {
      setStatus({
        phase: "idle",
        support,
        notice: deleted ? "The downloaded model was deleted from this device." : "No downloaded model was found on this device.",
      });
    }
  }

  async function summarize(content: string, isHtml: boolean, onTokens: (tokens: number) => void): Promise<SummaryResult> {
    if (status.phase !== "ready") return { ok: false, code: "MODEL_FAILED", message: "Enable local AI first." };
    const input = prepareSummaryInput(content, isHtml);
    if (!input.ok) return { ok: false, code: "INPUT_TOO_SHORT", message: aiErrorMessage("INPUT_TOO_SHORT") };

    const { support, device } = status;
    setStatus({ phase: "ready", support, device, busy: true });
    const result = await client().summarize(input.text, onTokens);

    setStatus((current) => {
      if (current.phase !== "ready") return current; // cancelled meanwhile
      if (!result.ok && (result.code === "OUT_OF_MEMORY" || result.code === "WORKER_CRASHED" || result.code === "TIMEOUT")) {
        return { phase: "error", support, device, code: result.code, message: result.message };
      }
      return { phase: "ready", support, device, busy: false };
    });
    return result.ok ? { ok: true, text: result.text, truncated: input.truncated } : result;
  }

  return (
    <LocalAiContext.Provider value={{ status, enable, cancel, unload, deleteModel, summarize }}>{children}</LocalAiContext.Provider>
  );
}
