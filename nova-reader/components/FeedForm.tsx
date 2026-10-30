"use client";
// The form where the user types a feed URL.
// Runs in the BROWSER. It checks the URL locally first (fast feedback),
// then calls onSubmit. The server checks the URL again.

import { useState, type FormEvent } from "react";
import { LoaderCircle, Rss, Search } from "lucide-react";
import { validateFeedUrl } from "@/lib/validation";

type FeedFormProps = {
  onSubmit: (url: string) => void;
  isLoading: boolean;
};

export function FeedForm({ onSubmit, isLoading }: FeedFormProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(url: string) {
    const result = validateFeedUrl(url);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    onSubmit(result.url);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); // stop the browser from reloading the page
    submit(value);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
      <label htmlFor="feed-url" className="block text-sm font-semibold text-ink">
        RSS or Atom feed URL
      </label>
      <p id="feed-url-hint" className="mt-1 text-sm text-ink-muted">
        Paste any independent blog or publication feed address to read privately.
      </p>

      <div className="mt-3 flex flex-col gap-2.5 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-muted" />
          <input
            id="feed-url"
            name="feed-url"
            type="url"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="https://example.com/feed.xml"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "feed-url-hint feed-url-error" : "feed-url-hint"}
            className={`min-h-12 w-full rounded-xl border bg-bg py-2.5 pr-3.5 pl-10 text-base text-ink placeholder:text-ink-muted/70 transition-colors ${
              error ? "border-danger" : "border-line focus:border-accent"
            }`}
          />
        </div>
        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-6 font-semibold text-accent-ink transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap"
        >
          {isLoading ? (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Rss aria-hidden="true" className="size-4" />
          )}
          {isLoading ? "Loading…" : "Load feed"}
        </button>
      </div>

      {error && (
        <p id="feed-url-error" className="mt-2.5 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
