// React hook that tells you if the browser thinks it is online.
// Runs in the BROWSER. Used by OfflineIndicator and the main page.

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Returns true when online, false when offline.
 * Note: `navigator.onLine === true` only means "connected to a network",
 * not "the internet definitely works". Requests can still fail.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine, // value in the browser
    () => true, // value during server rendering (assume online)
  );
}
