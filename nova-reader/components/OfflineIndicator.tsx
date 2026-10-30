"use client";
// Shows whether the browser is online or offline, and updates automatically.
// Runs in the BROWSER. It is honest: offline, only content stored on this device
// (saved articles and offline feed copies) can be shown.

import { Wifi, WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/lib/use-online-status";

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  return (
    <p
      role="status"
      aria-live="polite"
      className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-medium whitespace-nowrap ${
        isOnline ? "border-line bg-bg text-ink" : "border-warning/60 bg-warning-soft text-ink"
      }`}
    >
      {isOnline ? (
        <Wifi aria-hidden="true" className="size-4 text-accent" />
      ) : (
        <WifiOff aria-hidden="true" className="size-4 text-warning" />
      )}
      <span>{isOnline ? "Online" : "Offline: stored articles only"}</span>
    </p>
  );
}
