"use client";
// The form where the user types a feed URL.
// Runs in the BROWSER. It checks the URL locally first (fast feedback),
// then calls onSubmit. The server checks the URL again.

import { useState, type FormEvent } from "react";
import { LoaderCircle, Rss } from "lucide-react";
import { validateFeedUrl } from "@/lib/validation";

// Example feeds from independent blogs, so first-time users can try the app quickly.
const EXAMPLE_FEEDS = [
  { label: "Julia Evans (Atom)", url: "https://jvns.ca/atom.xml" },
  { label: "Simon Willison (Atom)", url: "https://simonwillison.net/atom/everything/" },
  { label: "Daring Fireball (RSS)", url: "https://daringfireball.net/feeds/main" },
];

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

  function loadExample(url: string) {
    setValue(url);
    submit(url);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <label htmlFor="feed-url" className="block text-sm font-semibold text-ink">
        RSS or Atom feed URL
      </label>
      <p id="feed-url-hint" className="mt-1 text-sm text-ink-muted">
        Paste the address of a feed, for example https://jvns.ca/atom.xml
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
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
          className={`min-h-11 w-full rounded-lg border bg-bg px-3 text-base text-ink placeholder:text-ink-muted/70 ${
            error ? "border-danger" : "border-line"
          }`}
        />
        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-accent px-5 font-semibold text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60 dark:text-bg"
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
        <p id="feed-url-error" className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-muted">Try:</span>
        {EXAMPLE_FEEDS.map((example) => (
          <button
            key={example.url}
            type="button"
            disabled={isLoading}
            onClick={() => loadExample(example.url)}
            className="rounded-full border border-line px-3 py-1 text-ink hover:border-accent hover:text-accent disabled:opacity-60"
          >
            {example.label}
          </button>
        ))}
      </div>
    </form>
  );
}
