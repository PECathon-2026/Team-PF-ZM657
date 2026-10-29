"use client";
// Shared look for error pages (Stage 9). Runs in the BROWSER.
// Shows a safe, plain-language message (never the raw error), a Try again
// button when retrying can help, and a way back to the reader.

import Link from "next/link";
import { CircleAlert, RotateCw } from "lucide-react";
import type { AppError } from "@/lib/app-errors";

type ErrorScreenProps = {
  title: string;
  error: AppError;
  reference?: string; // Next.js error digest: a hash, safe to show, matches server logs
  onRetry?: () => void;
};

export function ErrorScreen({ title, error, reference, onRetry }: ErrorScreenProps) {
  return (
    <main id="main" className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 py-12 text-center">
      <CircleAlert aria-hidden="true" className="size-10 text-danger" />
      <h1 className="mt-4 text-2xl font-semibold text-ink">{title}</h1>
      <p role="alert" className="mt-2 text-ink-muted">
        {error.message}
      </p>
      <p className="mt-1 text-sm text-ink-muted">Your saved articles and offline copies are safe on this device.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent px-4 font-semibold text-white hover:bg-accent-strong dark:text-bg"
          >
            <RotateCw aria-hidden="true" className="size-4" />
            Try again
          </button>
        )}
        <Link
          href="/"
          className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 font-medium text-ink hover:border-accent hover:text-accent"
        >
          Back to the reader
        </Link>
      </div>
      {reference && <p className="mt-6 text-xs text-ink-muted">Reference: {reference}</p>}
    </main>
  );
}
