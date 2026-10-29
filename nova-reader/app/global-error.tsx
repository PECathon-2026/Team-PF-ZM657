"use client";
// Last-resort error boundary (Stage 9): used only if the ROOT layout itself
// fails. It replaces the whole document, so it brings its own <html>/<body>
// and the global styles. Runs in the BROWSER.

import "./globals.css";
import { useEffect } from "react";
import { ErrorScreen } from "@/components/errors/ErrorScreen";
import { toAppError } from "@/lib/app-errors";
import { logError } from "@/lib/log";

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    logError("app", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <title>NOVA Reader – something went wrong</title>
        <ErrorScreen title="NOVA Reader could not start" error={toAppError(error)} onRetry={retry} />
      </body>
    </html>
  );
}
