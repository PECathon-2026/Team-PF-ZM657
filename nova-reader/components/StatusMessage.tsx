// Shows a loading / success / error / info message.
// Runs in the BROWSER (rendered inside the client page).
// Errors use role="alert" so screen readers announce them immediately;
// other messages use role="status", which is announced politely.

import { CircleAlert, CircleCheck, Info, LoaderCircle } from "lucide-react";

export type StatusKind = "loading" | "success" | "error" | "info";

const STYLES: Record<StatusKind, string> = {
  loading: "border-line bg-surface-muted text-ink",
  success: "border-accent/40 bg-accent-soft text-ink",
  error: "border-danger/40 bg-danger-soft text-ink",
  info: "border-warning/40 bg-warning-soft text-ink",
};

type StatusMessageProps = {
  kind: StatusKind;
  message: string;
};

export function StatusMessage({ kind, message }: StatusMessageProps) {
  const Icon = { loading: LoaderCircle, success: CircleCheck, error: CircleAlert, info: Info }[kind];
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${STYLES[kind]}`}
    >
      <Icon
        aria-hidden="true"
        className={`mt-0.5 size-4 shrink-0 ${kind === "loading" ? "animate-spin" : ""} ${
          kind === "error" ? "text-danger" : kind === "info" ? "text-warning" : "text-accent"
        }`}
      />
      <span>{message}</span>
    </div>
  );
}
