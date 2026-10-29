"use client";
// Registers the service worker (public/sw.js) so the app opens offline (Stage 9).
// Runs in the BROWSER. Only in production builds and secure contexts
// (HTTPS or localhost); in `npm run dev` it is skipped so caching never hides
// code changes. Failure is harmless: the app simply works online-only.

import { useEffect } from "react";
import { logError } from "@/lib/log";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error: unknown) => logError("service-worker", error));
  }, []);
  return null;
}
