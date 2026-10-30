// Shows what is stored for offline reading, with a button to delete it.
// Runs in the BROWSER. Offline copies live only in IndexedDB on this device.
// Saved articles (and their full text) are NOT deleted by this button.

import { HardDrive } from "lucide-react";

type OfflineCopiesProps = {
  count: number; // feed copies
  articleCount: number; // stored full articles (Stage 6)
  onClear: () => void;
  isClearing: boolean;
};

export function OfflineCopies({ count, articleCount, onClear, isClearing }: OfflineCopiesProps) {
  const nothingStored = count === 0 && articleCount === 0;
  return (
    <section aria-labelledby="offline-copies-title" className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <h2 id="offline-copies-title" className="flex items-center gap-2 font-semibold text-ink">
        <HardDrive aria-hidden="true" className="size-4 text-ink-muted" />
        Offline copies
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted tabular-nums">
        {count === 0
          ? "No feeds are stored yet. The last feeds you load (up to 10) are kept here so you can read them offline."
          : `${count} ${count === 1 ? "feed is" : "feeds are"} stored on this device for offline reading.`}
      </p>
      {articleCount > 0 && (
        <p className="mt-1 text-sm text-ink-muted tabular-nums">
          {`${articleCount} full ${articleCount === 1 ? "article is" : "articles are"} stored for the reading view.`}
        </p>
      )}
      {!nothingStored && (
        <button
          type="button"
          onClick={onClear}
          disabled={isClearing}
          className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-line bg-bg px-3.5 text-sm font-medium text-ink transition-colors hover:border-danger hover:text-danger disabled:opacity-60"
        >
          {isClearing ? "Clearing…" : "Clear offline copies"}
        </button>
      )}
    </section>
  );
}
