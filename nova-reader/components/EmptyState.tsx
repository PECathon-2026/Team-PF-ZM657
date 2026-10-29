// A friendly placeholder shown when a list has nothing in it.
// Runs in the BROWSER (rendered inside the client page). Purely visual.

import type { LucideIcon } from "lucide-react";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  message: string;
};

export function EmptyState({ icon: Icon, title, message }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <Icon aria-hidden="true" className="mb-3 size-8 text-ink-muted" />
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">{message}</p>
    </div>
  );
}
