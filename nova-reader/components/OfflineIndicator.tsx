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
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium ${
        isOnline ? "border-accent/40 bg-accent-soft text-ink" : "border-warning/50 bg-warning-soft text-ink"
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
