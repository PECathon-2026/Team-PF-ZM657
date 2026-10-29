"use client";
// Route-level error boundary (Stage 9). Runs in the BROWSER.
// Catches unexpected errors in "/" and "/radar" (and anything below the root
// layout). The header/layout stays, so navigation keeps working.

import { useEffect } from "react";
import { ErrorScreen } from "@/components/errors/ErrorScreen";
import { toAppError } from "@/lib/app-errors";
import { logError } from "@/lib/log";

export default function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    logError("page", error); // redacted: no stack, no URLs with query strings
  }, [error]);

  const appError = toAppError(error);
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : undefined;
  return <ErrorScreen title="This page could not be shown" error={appError} reference={digest} onRetry={retry} />;
}
