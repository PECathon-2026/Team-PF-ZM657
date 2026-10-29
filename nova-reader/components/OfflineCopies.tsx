// Shows how many feeds have an offline copy, with a button to delete them.
// Runs in the BROWSER. Offline copies live only in IndexedDB on this device.
// Saved articles are separate and are NOT deleted by this button.

import { HardDrive } from "lucide-react";

type OfflineCopiesProps = {
  count: number;
  onClear: () => void;
  isClearing: boolean;
};

export function OfflineCopies({ count, onClear, isClearing }: OfflineCopiesProps) {
  return (
    <section aria-labelledby="offline-copies-title" className="rounded-2xl border border-line bg-surface p-4">
      <h2 id="offline-copies-title" className="flex items-center gap-2 font-semibold text-ink">
        <HardDrive aria-hidden="true" className="size-4 text-ink-muted" />
        Offline copies
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        {count === 0
          ? "No feeds are stored yet. The last feeds you load (up to 10) are kept here so you can read them offline."
          : `${count} ${count === 1 ? "feed is" : "feeds are"} stored on this device for offline reading.`}
      </p>
      {count > 0 && (
        <button
          type="button"
          onClick={onClear}
          disabled={isClearing}
          className="mt-3 inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-sm font-medium text-ink hover:border-danger hover:text-danger disabled:opacity-60"
        >
          {isClearing ? "Clearing…" : "Clear offline copies"}
        </button>
      )}
    </section>
  );
}
