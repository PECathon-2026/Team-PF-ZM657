"use client";
// The "Local AI" panel (Stage 7; replaces the Stage 6 placeholder).
// Runs in the BROWSER. Shows support, asks before downloading, shows progress,
// and lets the user stop, turn off, or delete the model.

import { Cpu, FileText, MessageSquareText, Search, ShieldCheck, Sparkles, Trash, type LucideIcon } from "lucide-react";
import { LOCAL_AI_MODEL } from "@/lib/ai/config";
import { useLocalAi } from "./LocalAiProvider";

const PLANNED: { title: string; icon: LucideIcon }[] = [
  { title: "Find related saved articles", icon: Search },
  { title: "Ask questions about saved articles", icon: MessageSquareText },
];

export function AIWorkspace() {
  const { status, enable, cancel, unload, deleteModel } = useLocalAi();

  return (
    <section aria-labelledby="ai-title" className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="ai-title" className="flex items-center gap-2 text-lg font-semibold text-ink">
          <Sparkles aria-hidden="true" className="size-5 text-accent" />
          Local AI
        </h2>
        <span className="text-xs font-medium text-ink-muted">Optional · On-device</span>
      </div>
      <p className="mt-1.5 flex items-start gap-1.5 text-sm text-ink-muted">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        Runs inside this browser. Article text never leaves your device.
      </p>

      <div className="mt-3 space-y-3 text-sm" aria-live="polite">
        {status.phase === "checking" && <p className="text-ink-muted">Checking whether this device can run local AI…</p>}

        {status.phase === "unsupported" && (
          <p className="rounded-lg bg-surface-muted p-3 text-ink">
            Local AI is not available: {status.reason} Everything else in NOVA Reader works normally.
          </p>
        )}

        {status.phase === "idle" && (
          <>
            {status.notice && <p className="rounded-lg bg-accent-soft p-2 text-ink">{status.notice}</p>}
            <ul className="space-y-1 text-ink-muted">
              <li>
                Model: <span className="text-ink">{LOCAL_AI_MODEL.displayName}</span> ({LOCAL_AI_MODEL.license})
              </li>
              <li>
                Download: about <span className="text-ink">{status.support.approxDownloadMB} MB</span> from huggingface.co,
                once. It is stored in this browser.
              </li>
              <li>
                Runs on:{" "}
                <span className="text-ink">{status.support.device === "webgpu" ? "graphics card (WebGPU)" : "processor (WebAssembly)"}</span>
                {!status.support.webgpu.available && status.support.webgpu.reason && ` — ${status.support.webgpu.reason}`}
              </li>
            </ul>
            {status.support.lowMemory && (
              <p className="rounded-lg bg-warning-soft p-2 text-ink">This device reports little memory. Local AI may be slow or fail.</p>
            )}
            <button
              type="button"
              onClick={() => enable()}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-4 font-semibold text-accent-ink transition-colors hover:bg-accent-strong"
            >
              Download &amp; enable local AI
            </button>
          </>
        )}

        {status.phase === "loading" && (
          <>
            <LoadProgressBar loaded={status.progress?.loaded} total={status.progress?.total} percent={status.progress?.progress} />
            <button
              type="button"
              onClick={cancel}
              className="inline-flex min-h-11 items-center rounded-xl border border-line px-3.5 font-medium text-ink hover:border-danger hover:text-danger"
            >
              Cancel download
            </button>
          </>
        )}

        {status.phase === "ready" && (
          <>
            <p className="flex items-center gap-2 rounded-lg bg-accent-soft p-2 text-ink">
              <Cpu aria-hidden="true" className="size-4 text-accent" />
              Ready on {status.device === "webgpu" ? "the graphics card (WebGPU)" : "the processor (WebAssembly)"}. Open an
              article and choose “Summarize locally”.
            </p>
            <div className="flex flex-wrap gap-2">
              <SmallButton onClick={unload} disabled={status.busy}>
                Turn off
              </SmallButton>
              <SmallButton onClick={() => void deleteModel()} disabled={status.busy} danger>
                <Trash aria-hidden="true" className="size-3.5" /> Delete downloaded model
              </SmallButton>
            </div>
          </>
        )}

        {status.phase === "error" && (
          <>
            <p role="alert" className="rounded-lg border border-danger/40 bg-danger-soft p-2 text-ink">
              {status.message}
            </p>
            <div className="flex flex-wrap gap-2">
              <SmallButton onClick={() => enable(status.device)}>Try again</SmallButton>
              {status.device === "webgpu" && (
                <SmallButton onClick={() => enable("wasm")}>
                  Use CPU mode instead (about {LOCAL_AI_MODEL.variants.wasm.approxDownloadMB} MB)
                </SmallButton>
              )}
              <SmallButton onClick={() => void deleteModel()} danger>
                Delete downloaded model
              </SmallButton>
            </div>
          </>
        )}
      </div>

      <ul className="mt-4 space-y-2 border-t border-line pt-3">
        <li className="flex items-center gap-2 text-sm text-ink">
          <FileText aria-hidden="true" className="size-4 text-accent" />
          Summarize locally <span className="text-xs text-ink-muted">(in the reading view)</span>
        </li>
        {PLANNED.map(({ title, icon: Icon }) => (
          <li key={title} className="flex items-center gap-2 text-sm text-ink-muted">
            <Icon aria-hidden="true" className="size-4" />
            {title} <span className="text-xs">(planned)</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LoadProgressBar({ loaded, total, percent }: { loaded?: number; total?: number; percent?: number }) {
  const mb = (bytes: number) => Math.round(bytes / 1_000_000);
  const label =
    percent === undefined
      ? "Preparing download…"
      : total && total > 0
        ? `Downloading model… ${mb(loaded ?? 0)} MB of ${mb(total)} MB (${Math.round(percent)}%)`
        : `Loading model… ${Math.round(percent)}%`;
  return (
    <div>
      <p id="ai-progress-label" className="text-ink">
        {label}
      </p>
      <progress
        aria-labelledby="ai-progress-label"
        max={100}
        value={percent ?? undefined}
        className="mt-1 h-2 w-full overflow-hidden rounded-full accent-[var(--accent)]"
      />
    </div>
  );
}

function SmallButton({
  onClick,
  disabled,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-bg px-3.5 font-medium text-ink transition-colors disabled:opacity-60 ${
        danger ? "hover:border-danger hover:text-danger" : "hover:border-accent hover:text-accent"
      }`}
    >
      {children}
    </button>
  );
}
