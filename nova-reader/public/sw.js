// NOVA Reader service worker (Stage 9). Runs in the BROWSER, in the background.
// Purpose: let the app itself open and refresh while OFFLINE, so the offline
// feed copies and saved articles in IndexedDB can be read.
//
// What it caches (only files from this site, nothing personal):
//   - pages ("/", "/radar"): network first, the cached copy only when offline
//   - /_next/static/* (build files with hashed names, never change): cache first
// What it NEVER caches: /api/* (feeds, articles), the AI engine (/ort/), the
// AI model (handled by Transformers.js in its own cache), or other websites.
// Saved articles and offline copies live in IndexedDB, not here.

const VERSION = "nova-sw-v1"; // change when this file's caching rules change
const PAGES = `${VERSION}-pages`;
const STATIC = `${VERSION}-static`;
const APP_PAGES = ["/", "/radar"];
const MAX_STATIC_ENTRIES = 200;
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((cache) => cache.addAll(APP_PAGES))
      .catch(() => undefined) // installing must not fail just because one page could not be fetched
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("nova-sw-") && !key.startsWith(VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // other websites: never touched
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ort/") || url.pathname === "/sw.js") return;
  if (url.searchParams.has("_rsc") || request.headers.get("RSC")) return; // Next.js navigation data: network only

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request, url));
  } else if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirstStatic(request));
  }
});

async function networkFirstPage(request, url) {
  const cache = await caches.open(PAGES);
  const key = url.origin + url.pathname; // ignore ?query
  try {
    const response = await withTimeout(fetch(request), NETWORK_TIMEOUT_MS);
    if (response.ok && response.type === "basic" && APP_PAGES.includes(url.pathname)) {
      await cache.put(key, response.clone());
    }
    return response;
  } catch {
    const cached = (await cache.match(key)) || (await cache.match(url.origin + "/"));
    return cached || offlineResponse();
  }
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(STATIC);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    await cache.put(request, response.clone());
    trim(cache);
  }
  return response;
}

async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_STATIC_ENTRIES))) await cache.delete(key);
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

function offlineResponse() {
  return new Response(
    "<!doctype html><meta charset=utf-8><title>Offline · NOVA Reader</title><main style='font-family:system-ui;padding:2rem'><h1>You are offline</h1><p>NOVA Reader has not been opened on this device while online yet, so it cannot start offline. Connect once and try again.</p></main>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
