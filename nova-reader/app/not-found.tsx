// 404 page (Stage 9). Runs on the SERVER (static). Has a <main> landmark and a
// clear way back, and does not reveal anything about the server.

import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Page not found · NOVA Reader" };

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 py-12 text-center">
      <p className="text-sm font-semibold text-accent">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-ink">Page not found</h1>
      <p className="mt-2 text-ink-muted">This page does not exist. Your saved articles are still on this device.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/" className="inline-flex min-h-10 items-center rounded-lg bg-accent px-4 font-semibold text-white hover:bg-accent-strong dark:text-bg">
          Back to the reader
        </Link>
        <Link href="/radar" className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 font-medium text-ink hover:border-accent hover:text-accent">
          Knowledge Radar
        </Link>
      </div>
    </main>
  );
}
