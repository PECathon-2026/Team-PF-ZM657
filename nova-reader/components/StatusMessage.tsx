// Shows a loading / success / error / info message, with an optional button
// (for example "Try again" after an error).
// Runs in the BROWSER (rendered inside the client page).
// Errors use role="alert" so screen readers announce them immediately;
// other messages use role="status", which is announced politely.

import { CircleAlert, CircleCheck, Info, LoaderCircle, RotateCw } from "lucide-react";

export type StatusKind = "loading" | "success" | "error" | "info";

const STYLES: Record<StatusKind, string> = {
  loading: "border-line bg-surface-muted text-ink",
  success: "border-accent/40 bg-accent-soft text-ink",
  error: "border-danger/40 bg-danger-soft text-ink",
  info: "border-warning/40 bg-warning-soft text-ink",
};

export type StatusAction = {
  label: string;
  onClick: () => void;
};

type StatusMessageProps = {
  kind: StatusKind;
  message: string;
  action?: StatusAction;
};

export function StatusMessage({ kind, message, action }: StatusMessageProps) {
  const Icon = { loading: LoaderCircle, success: CircleCheck, error: CircleAlert, info: Info }[kind];
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 text-sm ${STYLES[kind]}`}>
      <p role={kind === "error" ? "alert" : "status"} className="flex min-w-0 flex-1 items-start gap-2">
        <Icon
          aria-hidden="true"
          className={`mt-0.5 size-4 shrink-0 ${kind === "loading" ? "animate-spin" : ""} ${
            kind === "error" ? "text-danger" : kind === "info" ? "text-warning" : "text-accent"
          }`}
        />
        <span>{message}</span>
      </p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 font-medium text-ink transition-colors hover:border-accent hover:text-accent"
        >
          <RotateCw aria-hidden="true" className="size-4" />
          {action.label}
        </button>
      )}
    </div>
  );
}
