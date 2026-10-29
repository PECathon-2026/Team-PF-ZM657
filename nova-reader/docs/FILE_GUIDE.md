# File guide (for beginners)

This page explains every file we wrote: what it is for, **where it runs**, and its important functions.

- **Server** means it runs in Node.js on the machine hosting the app (your laptop during `npm run dev`, Vercel after deployment).
- **Browser** means it runs on the user's device.
- **Both** means it is plain TypeScript with no server-only or browser-only code.

---

## app/

### `app/api/feed/route.ts` — Server

The only API endpoint: `GET /api/feed?url=<encoded-feed-url>`. It is three lines: it calls `handleFeedRequest()` from `lib/server/feed-handler.ts`. (Next.js route files may only export HTTP handlers, and keeping the logic in `lib/server/` lets tests pass a fake DNS and network.) There is no `export const runtime`: with Cache Components, Next.js always uses Node.js and forbids that export.

### `app/api/article/route.ts` — Server (Stage 6)

`GET /api/article?url=<encoded-article-url>`. Three lines: calls `handleArticleRequest()` from `lib/server/article-handler.ts`.

### Stage 9 error pages — Browser / Server

| File | What it does |
| --- | --- |
| `app/error.tsx` (browser) | Catches unexpected errors on `/` and `/radar`. Shows a safe message from `toAppError()`, **Try again** (`retry()`, Next 16), **Back to the reader**, and the error digest as a reference. Logs one redacted line. |
| `app/global-error.tsx` (browser) | Used only if the root layout fails; brings its own `<html>`/`<body>` and styles. |
| `app/not-found.tsx` (server) | 404 page with a `<main>` landmark and links back. |
| `app/api/[...path]/route.ts` (server) | Any unknown `/api/...` path, any method → `{ success: false, error: { code: "NOT_FOUND" } }` with status 404. |
| `components/errors/ErrorScreen.tsx` | The shared error layout. |
| `components/ServiceWorkerRegistration.tsx` | Registers `public/sw.js` in production builds on secure origins; renders nothing. |

### `app/layout.tsx` — Server

The HTML shell (`<html>`, `<body>`) and page title. Uses system fonts, so no font is downloaded from Google (faster and more private).

### `app/page.tsx` — Browser (`"use client"`)

The main page. It holds the app's **state** and connects all components.

| Function / state | What it does |
| --- | --- |
| `feed`, `status`, `isLoadingFeed` | The loaded feed and the loading/success/error message. |
| `saved`, `savedError` | Saved articles from IndexedDB. |
| `useEffect(...)` | Loads saved articles once when the page opens. |
| `requestFeed(url)` | Refuses when offline; cancels any older request; calls `loadFeed()` from `lib/feed-client.ts`; shows the feed, or an error with **Try again** when retrying could help. |
| `toggleSave(article)` | Saves or removes an article in IndexedDB and updates the list. |

### `app/radar/page.tsx` + `app/radar/layout.tsx` (Stage 8)

`/radar` — **Browser** page (`"use client"`). On open (and on **Refresh**) it reads `getSavedArticles()`, `listCachedFeeds()` and `listExtractedArticles()` from IndexedDB, runs `buildRadar()`, and shows: four stat tiles, topics, sources, saved per week, languages, and “What the radar cannot see”. Empty and error states included. The layout file (server) only sets the page title.

### `app/globals.css` — Browser

Imports Tailwind and defines colour tokens (`--accent`, `--ink`, …) for light and dark mode, a strong keyboard focus ring, and reduced-motion support.

---

## components/ — all Browser

| File | Purpose |
| --- | --- |
| `FeedForm.tsx` | The URL input. `submit()` validates with `validateFeedUrl()` and shows the error under the input (linked with `aria-describedby`). The button is disabled while loading. Has three example feeds. |
| `FeedList.tsx` | Feed title, description, article count, website link, and the list of `ArticleCard`s. Shows an empty state if the feed has no articles. `FeedListSkeleton` shows grey placeholder cards while loading (hidden from screen readers). |
| `ArticleCard.tsx` | One article: title, `<time>` date, author, 3-line summary, **Read**, **Save** (`aria-pressed` shows its state) and **Original** link (`rel="noopener noreferrer"`). The `compact` variant is used in the sidebar. |
| `ReaderView.tsx` (Stage 6) | Reading dialog. `ReaderBody` (keyed by article) shows the feed text first, then the full article from `useArticleExtraction`, with **Full article / Feed text** toggle buttons (`aria-pressed`), a loading message, a clear fallback with **Try again** when useful, and the original link. |
| `ArticleContent.tsx` | Sanitizes `contentHtml` with `sanitizeArticleHtml()` and inserts the cleaned nodes into an empty `<div>` (`replaceChildren`). Link styles come from `.article-content` in `globals.css`. |
| `SavedArticles.tsx` | The "Saved on this device" section: loading, error, empty and list states. |
| `radar/StatTile.tsx`, `radar/BarList.tsx`, `radar/WeeklyColumns.tsx`, `radar/DataTable.tsx` (Stage 8) | Headline numbers; horizontal bars with value at the tip and a hover/focus tooltip on each row; an SVG column chart (1px grid, 4px rounded tops, labels on the latest and busiest weeks only, per-column tooltip, drawn at real pixel width); and a “Show as table” view. Labels are always rendered as text. |
| `OfflineCopies.tsx` | Shows how many feeds have an offline copy and a **Clear offline copies** button. |
| `OfflineIndicator.tsx` | Badge showing "Online" or "Offline: saved articles only". `role="status"` makes screen readers announce changes. |
| `AIWorkspace.tsx` (Stage 7) | The Local AI panel: “checking”, “not available (reason)”, model + size + source + device **before** downloading, **Download & enable**, progress bar with **Cancel download**, ready state with **Turn off** / **Delete downloaded model**, and error messages with **Try again** / **Use CPU mode instead**. |
| `LocalAiProvider.tsx` (Stage 7) | React context with ONE `LocalAiClient` for the page. Runs feature detection on mount (no download), creates the client only in `enable()`, exposes `summarize()`, `cancel()`, `unload()`, `deleteModel()`. Without a provider, local AI is simply “not available”. |
| `LocalSummary.tsx` (Stage 7) | “Summarize locally” in the reading view: progress (“Writing summary… 40%”), **Stop**, result as **plain text** with a “may be wrong” note, or a clear message. |
| `EmptyState.tsx` | A friendly "nothing here yet" box with an icon. |
| `StatusMessage.tsx` | A coloured message. Errors use `role="alert"` (announced immediately); others use `role="status"`. Optional `action` adds a button, used for **Try again**. |

**Safety rule used everywhere:** feed content is rendered as text with `{value}` in JSX, so React escapes it. The one exception is article HTML in `ArticleContent`, which is always sanitized by DOMPurify first. We never use `dangerouslySetInnerHTML`.

---

## lib/

### `lib/radar.ts` — Both (pure, used in the browser) (Stage 8)

| Function | What it does |
| --- | --- |
| `buildRadar({ saved, feeds, extracted, now })` | Builds the whole report. Pure and deterministic; never changes its inputs. |
| `sourceName(article)` | Feed title, else the website host name. |
| `keywordsOf(text)` | Lower-case words of 4+ letters (any alphabet), minus a stop-word list. |
| `perWeek(dates, now, weeks)` | Counts per Monday-to-Sunday week (local time); too old or invalid dates are ignored. |
| `topWithOther(items, n)` | Keeps the top `n` and folds the rest into “Other (k)”. |
| `countWords`, `languageName` | Word counting; `"en-US"` → “English”. |

Topics: an article counts once per topic, whether the topic is a feed category or a word in its text. `notAvailable` lists what the app does not store.

### `lib/app-errors.ts`, `lib/log.ts`, `lib/zod-setup.ts` — Both (Stage 9)

| Function | What it does |
| --- | --- |
| `toAppErrorCode(code)` | Maps every earlier code (API, browser request, storage, extraction, AI) onto the 11 `AppErrorCode`s. |
| `toAppError(error)` | Any thrown value → `{ code, message, retryable }` with a **fixed** friendly message (the raw message is never used). |
| `redact(text)` / `describeForLog(error)` | Remove URL credentials and query strings, bearer tokens, `KEY=value` secrets and file paths; one line, max 200 characters; no stack. |
| `logError(scope, error)` | The only logging helper: `[nova:scope] CODE redacted-description`. |
| `lib/zod-setup.ts` | `config({ jitless: true })` so Zod never probes `eval`, which the CSP forbids. Imported by every module that defines schemas (also inside the AI worker). |

### `public/sw.js` — Service worker (Stage 9)

Network-first for pages (`/`, `/radar`, cached copy only when offline), cache-first for `/_next/static/*` (hashed, max 200 entries), and nothing else. It never caches `/api/*`, `/ort/`, the AI model or other origins. Old caches are deleted on activation; bump `VERSION` when rules change.

### `lib/feed-types.ts` — Both

Only types and constants: `FeedItem`, `Feed`, `FeedInfo`, `SavedArticle`, `ReadableArticle`, the API response types, the list of error codes, and `MAX_FEED_ITEMS = 50`.

### `lib/feed-parser.ts` — Both (currently called by the server)

| Function | What it does |
| --- | --- |
| `parseFeedXml(xml, feedUrl, options?)` | Main function. Rejects XML over 2 MB, empty or malformed XML, detects RSS 2.0, RSS 1.0 or Atom (also `<atom:feed>` with a prefix), and returns a `Feed`. Throws `FeedParseError` (`INVALID_XML`, `UNSUPPORTED_FORMAT` or `RESPONSE_TOO_LARGE`). `options.maxItems` can lower the 50-article limit. `parseFeed` is the older name for the same function. |
| `safeParseFeedXml(...)` | Same, but returns `{ ok: true, feed }` or `{ ok: false, code, message }` instead of throwing. |
| `findImage(item, baseUrl)` | Looks for an image in enclosures, `media:thumbnail`, `media:content`, `media:group` and `itunes:image`. Unsafe URLs are skipped. |
| `cleanText` / `cleanCategories` | Plain text, normalized whitespace, length limits (title 500, author 300, category 100, max 20 categories). |
| `parseRss` / `parseRssItem` | Reads `<channel>` and `<item>`: title, link (or guid), `content:encoded` or description, `dc:creator`, `pubDate`, and an image from `enclosure` / `media:*`. |
| `parseAtom` / `parseAtomEntry` | Reads `<feed>` and `<entry>`: `link rel="alternate"`, content or summary, `author/name` (falls back to the feed author), `published` or `updated`. |
| `finalizeItems(items, maxItems)` | Removes duplicate URLs and IDs, sorts newest first, and keeps at most 50. |
| `text`, `attr`, `asArray`, `asNode`, `nodes`, `stripPrefix` | Small, safe helpers for reading the unknown-shaped XML tree without using `any`. |

Items without a valid http(s) link are skipped, because there is nothing to open.

`keepHtml(content)` keeps the raw content as `contentHtml` when it contains HTML tags (max 200,000 characters). It is **not** sanitized here; the browser does that right before display.

### `lib/validation.ts` — Both

| Function / value | What it does |
| --- | --- |
| `validateFeedUrl(input)` | Returns `{ ok: true, url }` or `{ ok: false, code, message }`. Checks: non-empty, max 2048 characters, a real URL, http(s) only, no `user:pass@`, not a blocked host. Never throws. |
| `isBlockedHostname(host)` | Blocks `localhost`, `*.local`, `*.internal`, private/loopback/link-local IPv4 and IPv6. Text check only (see README security limitations). |
| `feedApiResponseSchema` | Zod schema the browser uses to check the API's JSON before trusting it. |

### `lib/feed-client.ts` — Browser

| Function | What it does |
| --- | --- |
| `buildFeedApiUrl(url)` | `/api/feed?url=` + the encoded feed URL. |
| `loadFeed(url, { signal?, timeoutMs?, fetchImpl? })` | Validates the URL, calls the Stage 3 route (never the feed site itself), checks the JSON with Zod. **Never throws**: returns `{ ok: true, feed, items }` or `{ ok: false, code, message, retryable }`. Adds browser-only codes `NETWORK_ERROR`, `CLIENT_TIMEOUT` (20 s), `BAD_RESPONSE` (e.g. an HTML error page) and `CANCELLED`. |

### `lib/api-request.ts`, `lib/article-client.ts` — Browser (Stage 6)

`getApiJson(path, schema, options)` is the shared caller used by `loadFeed()` and `fetchArticlePage()`: timeout (20 s), cancel, Zod check, never throws, `retryable` flag. `fetchArticlePage(url)` validates the URL and calls `/api/article`.

### `lib/article-extractor.ts` — Browser (Stage 6)

`extractReadableArticle(html, pageUrl, articleUrl)` parses the page with `DOMParser` (inert: scripts never run, nothing is loaded), replaces any `<base>` with the real page URL so relative links resolve correctly, runs Readability on a **clone** (`maxElemsToParse` 25,000), and returns title, byline, site name, excerpt, language, published time and `contentHtml` — or a failure reason (`NOT_HTML`, `TOO_COMPLEX`, `NO_ARTICLE_FOUND`, `TOO_SHORT` < 250 characters, `TOO_LARGE` > 500,000 characters) with a readable message. The HTML is still untrusted; it is sanitized when shown.

### `lib/use-article-extraction.ts` — Browser (Stage 6)

`useArticleExtraction(url)` returns `{ state, retry }`. `getReadableArticle()` tries the stored copy first, then (if online) downloads, extracts and stores. States: `loading`, `ready` (`source: "stored" | "network"`), `failed` (`message`, `retryable`).

### `lib/ai/` — Local AI (Stage 7)

| File | Runs in | What it does |
| --- | --- | --- |
| `config.ts` | both | Model id (`Xenova/t5-small`), `summarize: ` prefix, limits (2,000 input characters, 120 new tokens), variants (`wasm`/`q8` ≈ 80 MB, `webgpu`/`fp16` ≈ 156 MB), `/ort/` path, cache name, 2-minute timeout. |
| `capabilities.ts` | browser | `detectLocalAiSupport()` — never throws. Needs Worker + WebAssembly. WebGPU only with a secure context, `navigator.gpu`, an adapter (3-second timeout) and `shader-f16`; otherwise CPU. Flags devices with < 4 GB memory. |
| `protocol.ts` | both | Typed messages page ↔ worker, a **Zod schema for every message from the worker**, error codes and friendly messages, `classifyAiError()` (memory / download / WebGPU / other). |
| `text.ts` | both | `prepareSummaryInput()` (HTML → text, cut at a sentence end, add prefix) and `validateSummary()` (string, 15–1,500 characters, mostly letters, no repetition loop, markup and control characters removed). |
| `worker-logic.ts` | worker | `createAiWorkerHandler()` — load (throttled progress) and summarize (token progress), errors turned into codes. No library import, so it is unit-tested with a fake model. |
| `local-ai-client.ts` | browser | `LocalAiClient`: creates the worker only in `load()`, checks every message, validates summaries, timeout, one job at a time, `cancel()` = `worker.terminate()`. `deleteDownloadedModel()` clears Cache Storage. |

### `workers/ai.worker.ts` — Web Worker (Stage 7)

Connects `worker-logic.ts` to Transformers.js: `pipeline("summarization", model, { device, dtype, progress_callback })`, a `TextStreamer` to count tokens, `env.allowLocalModels = false`, and it points ONNX Runtime at `/ort/` instead of cdn.jsdelivr.net.

### `scripts/copy-onnx-wasm.mjs` — build tool

Copies four ONNX Runtime engine files from `node_modules/onnxruntime-web/dist` to `public/ort/`. Runs automatically as `predev` and `prebuild`.

### `lib/db.ts` — Browser

Dexie database named `nova-reader`:

- **Version 1** (Stage 4): `savedArticles` (primary key `id`, index `savedAt`).
- **Version 2** (Stage 5): adds `cachedFeeds` (primary key `requestedUrl`, index `cachedAt`). Dexie upgrades old databases automatically and keeps saved articles.
- **Version 3** (Stage 6): adds `extractedArticles` (primary key `url`, index `extractedAt`) and a `url` index on `savedArticles`.

| Function | What it does |
| --- | --- |
| `getSavedArticles()` | All saved articles, newest saved first. |
| `saveArticle(article, feedTitle)` | Stores an article with `savedAt = now`. Saving twice just updates it. |
| `removeSavedArticle(id)` | Deletes one article. |
| `cacheFeed(requestedUrl, feed, items)` | Stores (or replaces) the offline copy of a feed, then deletes the oldest copies so at most 10 remain — all in one transaction. |
| `getCachedFeed(url)` / `getLatestCachedFeed()` | Read a copy back. Records are checked with Zod; broken or outdated ones are ignored. |
| `countCachedFeeds()` / `clearCachedFeeds()` | Count / delete offline copies (saved articles are not touched). |
| `toLocalStorageError(error, message)` | Turns any storage error into a `LocalStorageError` with `kind` `QUOTA_EXCEEDED` (storage full), `UNAVAILABLE` (blocked / private mode / no IndexedDB) or `FAILED`. Raw browser error text is never shown to users. |
| `getExtractedArticle(url)` / `storeExtractedArticle(article)` | Stage 6. Read / store a full article. Keeps at most 50, oldest removed first, **except** full text of saved articles. Records are checked with Zod. |
| `listCachedFeeds()` / `listExtractedArticles()` | Stage 8, **read-only**: all valid feed copies / full articles, newest first (invalid records skipped). Used by the radar. |
| `countExtractedArticles()` / `clearOfflineCopies()` | Count stored full articles / delete all feed copies and every full article that does not belong to a saved article. |
| `closeDatabase()` | Closes the connection; tests use it to simulate a page refresh. |

### `lib/html-limits.ts` — Browser (bug fix #2)

`isHtmlTooDeeplyNested(html)` scans the raw HTML once, using `indexOf` only, and estimates how deeply elements are nested. It ignores void tags, tags whose end tag is optional, comments and script/style content. Deeper than `MAX_HTML_NESTING_DEPTH` (500) counts as too complex. Browsers parse such markup very slowly (quadratic beyond Chromium's ~512-level cap), so this runs **before** any parsing.

### `lib/sanitize-html.ts` — Browser

| Function | What it does |
| --- | --- |
| `sanitizeArticleHtml(html, baseUrl)` | Runs DOMPurify with a short allow-list of reading tags (`p`, `a`, `em`, lists, headings…) and only the `href`/`title` attributes (`data-*` attributes are dropped too, Stage 10). Returns a `DocumentFragment`. Too-deeply nested HTML is never parsed; it becomes plain `<p>` paragraphs (text only). |
| `secureLink(link, baseUrl)` | Resolves the link against the article URL. Keeps it only if it is http(s), otherwise removes `href` (the text stays). Adds `target="_blank"` and `rel="noopener noreferrer nofollow ugc"`. |

### `lib/server/` — Server only

Every file starts with `import "server-only"`, so Next.js fails the build if browser code imports it.

| File | Function | What it does, in plain words |
| --- | --- | --- |
| `feed-handler.ts` | `handleFeedRequest(request, deps?)` | Rate limit → Stage 2 `validateFeedUrl()` → `fetchFeedXml()` → `parseFeedXml()` → JSON. Any error becomes `{ success: false, error: { code, message } }` with a safe message. Unknown errors are logged on the server and the browser only sees "Something went wrong". Adds `no-store`, `nosniff` and CSP headers. |
| `article-handler.ts` | `handleArticleRequest(request, deps?)` | Stage 6. Rate limit (own limiter) → Stage 2 URL check → `fetchTextSafely()` with HTML-only content types and a 3 MB limit → `{ success: true, page: { url, html } }`. It never parses or stores the page. |
| `responses.ts` | `SECURITY_HEADERS`, `errorJson()` | Shared by both routes. The CSP + nosniff headers mean a response can never be treated as a web page. |
| `feed-fetcher.ts` | `fetchTextSafely(url, request, options?)` | Stage 6: the shared secure loop (SSRF check per hop, pinned DNS, ≤3 redirects, 10 s, size limit, status, content type, charset). `request` sets the Accept header, the wording ("feed"/"article") and the content-type check. |
| | `assertArticleContentType` | Allows `text/html` and `application/xhtml+xml` (or a generic type if the body starts like HTML). PDFs, images, JSON, feeds → `UNSUPPORTED_CONTENT_TYPE`. |
| | `fetchFeedXml(url, options?)` | One 10-second deadline for everything. For every hop: `assertSafeDestination()`, then one request. Redirects (max 3) are followed by hand. Checks the status (2xx only), the content type (XML types; `text/plain` only if the body is XML) and decodes the charset. |
| | `assertFeedContentType`, `decodeBody` | Content-type rule and charset detection (header → byte-order mark → `<?xml encoding>` → UTF-8). |
| `http-client.ts` | `httpGetOnce(url, options)` | One GET with `node:http(s)`. Uses our `lookup` (pinned DNS), a fresh connection (`agent: false`), the shared abort signal, and stops reading after 2 MB **after** decompression (gzip/deflate/brotli), which stops "gzip bombs". |
| `ssrf.ts` | `isPublicIpAddress(ip)` | True only for public IPv4 and global IPv6. Blocks loopback, private, link-local/metadata, CGNAT, multicast, reserved, documentation, IPv4-mapped, NAT64, 6to4, Teredo… |
| | `resolvePublicAddresses(host, resolver)` | Resolves A + AAAA. Refuses if **any** address is not public. DNS errors become a generic message. |
| | `createPinnedLookup(resolver)` | The DNS function Node uses **while connecting**. It validates and returns only the checked addresses, so DNS rebinding cannot swap in a private IP. |
| | `assertSafeDestination(url)` | Stage 2 checks + allowed ports (80, 443, 8080, 8443) + literal-IP check. Used for the first URL and every redirect. |
| `rate-limit.ts` | `RateLimiter`, `InMemoryRateLimiter`, `getClientKey` | Interface + MVP in-memory limiter (30/min per client, memory-capped). Client key = salted hash of the IP, never the raw IP. Replace with a shared store for production. |
| `errors.ts` | `FeedRouteError` | Error with `code`, HTTP `status` and a message that is safe to show. |

### `lib/use-online-status.ts` — Browser

`useOnlineStatus()` is a React hook that returns `true`/`false` and re-renders when the browser fires `online`/`offline` events (`useSyncExternalStore`).

### `lib/utils.ts` — Both

| Function | What it does |
| --- | --- |
| `toSafeString(value)` | Strings stay strings, numbers/booleans become text, anything else becomes `""`. |
| `normalizeWhitespace(text)` | Tabs, new lines, non-breaking and other Unicode spaces → one space; removes zero-width characters. |
| `htmlToText(html)` | Removes scripts, styles and tags; keeps paragraph breaks. |
| `truncate(text, max)` | Cuts long text and adds "…". |
| `toSafeHttpUrl(value, base?)` | Resolves relative links; returns `undefined` for anything that is not http(s). |
| `removeDuplicateUrls(items)` | Keeps the first item per URL (ignoring `#fragment`). |
| `toIsoDate(value)` | ISO date string, or `undefined` for invalid dates or years outside 1900–2200. |
| `createArticleId(feedUrl, source)` | Deterministic ID. Priority: GUID/Atom ID → URL → title + date → fallback text. |
| `hashString`, `decodeHtmlEntities`, `formatDate` | Small helpers (stable hash, `&amp;` → `&`, human-readable dates). |

---

## tests/

| File | What it covers |
| --- | --- |
| `feed-parser.test.ts` | Valid RSS, valid Atom, empty feed, missing title, missing description, duplicate links, invalid XML, empty input, non-feed XML, invalid dates, relative URLs (two cases), `javascript:` links, more than 50 items, stable IDs, content preference. |
| `sanitize-html.test.ts` | Runs in jsdom. Absolute link (NASA case), relative links, text without links, unsafe schemes (`javascript:`, `data:`, `vbscript:`…), dangerous markup (scripts, event handlers, iframes, forms, SVG, styles), no remote images. |
| `validation.test.ts` | Good URLs, trimming, empty/non-string input, malformed URLs, long URLs, bad protocols, credentials, localhost and private IPs, response schema. |
| `feed-route.test.ts` | The API with fake DNS + network (real SSRF checks): success + schema, headers, safe redirects, missing/invalid URL, protocols, credentials, localhost, loopback, private IPs, metadata, unsafe IPv6, bad ports, hostnames resolving to private/mixed addresses, unsafe redirects, upstream errors, connection failures, timeout, oversized response, too many redirects, content types, malformed XML, non-feed XML, charsets, no leaked stack traces, rate limiting. |
| `feed-client.test.ts` | URL encoding, calls the route not the feed, validation before calling, server errors, retryable vs permanent errors, non-JSON reply, wrong JSON shape, network failure, client timeout, cancel. |
| `home-page.test.tsx` | Renders the real page (jsdom + React Testing Library + fake IndexedDB): labelled input, validation errors, Enter key, correct API URL, loading state + disabled button + skeleton, feed title/description/articles/author/date, missing fields, safe links, empty feed, feed text never rendered as HTML, error + **Try again**, network failure, non-JSON reply, no retry for permanent errors, previous feed kept on failure. Stage 5: save survives a refresh, remove, last feed shown on the next visit then updated, offline copy used when offline (no server call), page opened while offline, no-copy message, network-failure fallback, clear offline copies keeps saved articles. |
| `db.test.ts` | Stage 6 additions: full articles stored/read after refresh, max 50 but saved articles' full text kept, clearing keeps saved full text, invalid records ignored, **upgrade from the Stage 5 (v2) database**. Earlier: real IndexedDB behaviour via fake-indexeddb: save/list/remove, survives a refresh, ordering and updates, feed copies by URL, latest copy, replace, keep only 10, corrupted records ignored, clearing keeps saved articles, **upgrade from the Stage 4 (v1) database**, storage-full / blocked / missing-IndexedDB errors, nothing sent to the network. |
| `home-page-storage-errors.test.tsx` | The page when storage fails: the feed still shows and explains no offline copy was kept; saving shows a clear error. |
| `article-route.test.ts` | `/api/article`: raw HTML in JSON, security headers, no server-side changes, safe redirect, 3 MB limit, XHTML/generic types, all SSRF/input cases, DNS → private, unsafe redirect, redirect limit, non-HTML types (PDF, image, JSON, RSS), upstream error, timeout, oversized, connection failure without details, no stack traces, own rate limit. |
| `article-extractor.test.ts` | Readability + DOMPurify on a messy page: main text and metadata, nav/ads/cookie banner/footer removed, relative links resolved (page's own `<base>` ignored), safe links, scripts/handlers never run, no script/iframe/img/style/`javascript:`, tables kept, input not modified, failures for non-articles, empty/non-HTML input, overly complex pages. |
| `article-client.test.ts` | Calls `/api/article` (not the site), refuses unsafe URLs, error pass-through with retry hints, wrong JSON shape. |
| `reader-view.test.tsx` | Feed text first then full article, only sanitized content, toggle, original link, stored for offline and reopened offline, saved articles, fallback when nothing extractable, server error message, Try again recovers, offline with nothing stored. |
| `helpers/` | `article-fixture.ts` (messy test page) and `fake-internet.ts` (fake DNS + network that still runs the real SSRF checks). |
| `ai-core.test.ts` | Capability detection (WebGPU ok / no HTTPS / no `navigator.gpu` / no adapter / no `shader-f16` / throws / hangs, no Worker, no WebAssembly, low memory), input preparation, output validation (markup, control characters, too short/long, symbols, repetition), error classification, worker message schema. |
| `ai-client.test.ts` | Client + real worker logic + fake model: no worker before `load()`, progress, `q8`/`fp16` choice, download / WebGPU / memory failures, cancel during download and during a summary, crash, worker blocked, validated summary, invalid output rejected, malformed messages, stale request ids, timeout, busy guard, no network use. |
| `ai-ui.test.tsx` | Panel and summary UI: unsupported message, size/source/device shown before download, no worker until click, progress, cancel, download error + Try again, CPU-mode offer after WebGPU failure, memory error, delete model, summary progress + plain-text result + “may be wrong” note, markup never rendered, Stop, unusable output hidden, too-short text, button in the reading view, home page still works without AI. |
| `helpers/fake-ai-worker.ts` | A fake worker that runs the real worker logic with a fake model. |
| `radar.test.ts` | Empty state, totals, inputs unchanged, categories (case-insensitive), category **or** keyword counted once per article, counting articles not repetitions, full text used, 2-article rule, topic limit, no invented topics, keywords/stop words/other alphabets, sources + “Other”, weeks (Monday start, old/invalid dates ignored), reading depth, languages, word counting, “cannot see” notes. |
| `radar-page.test.tsx` | `/radar` with real IndexedDB behaviour: empty state, summary numbers, topics/sources/languages, chart present, honest notes, keyboard tooltip, table view, Refresh, no network use, storage unavailable. |
| `app-errors.test.ts` | Every API and AI code maps to an app code; raw messages never used; storage, timeout and chunk-load errors; redaction of credentials, query strings, secrets, bearer tokens and paths; one-line logs; JSON 404 for unknown API paths. |
| `error-pages.test.tsx` | Error page shows only a safe message, Try again calls `retry`, a link back, a reference; logs are redacted; 404 page has a main landmark. |
| `e2e/*.spec.ts` (Playwright) | `smoke` (feed, save, read, radar, 404), `security` (headers, real API errors, no CSP violations, no third-party requests, CSP blocks others, local AI under CSP), `accessibility` (axe light + dark, keyboard), `offline` (opens and reloads offline; API never cached), `deep-nesting` (hostile nested feed HTML and 3 MB page don't freeze the reader). |
| `ssrf.test.ts` | IP policy (IPv4 + IPv6 special ranges), DNS validation, pinned lookup in both Node modes, DNS-rebinding simulation, port policy. |
| `utils.test.ts` | `truncate()`: unchanged short text, never longer than the limit, ellipsis, limit 1, and limits of 0, negative, `NaN`, fractional and Infinity (bug #1). |
| `html-limits.test.ts` | Depth check: boundary, unclosed tags, no false positives, void/optional tags, comments/scripts, broken input, 3 MB hostile input. Sanitizer and extractor stay fast on deep nesting; safe text fallback (bug #2). |
| `release-regressions.test.ts` (Stage 10) | Unusual URL spellings blocked on the server (hex/octal/short/decimal IPv4, trailing dots, IPv4-mapped/compatible IPv6, NAT64, 6to4, zone IDs, metadata hosts, bad ports, backslash and credential tricks), punycode hosts accepted; sanitizer: encoded `javascript:` links, SVG/MathML, `style`/`data-*`/event attributes, no remote media/`<base>`/`<meta>`, safe new-tab links, deeply nested input. |
| `http-client.test.ts` | Real local HTTP server: body/headers, gzip, redirects not followed, Content-Length limit, streaming limit, gzip bomb, timeout, unknown encoding, refused connection, and proof that the real pinned lookup never lets a request reach 127.0.0.1. |

## Config files

| File | Purpose |
| --- | --- |
| `package.json` | Dependencies and scripts (`dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:run`, `test:watch`, `test:e2e`, `check`). Version `1.0.0-beta.1`; `engines.node >= 20.9`. |
| `vitest.config.mts` | Test settings; makes `@/` imports work in tests and maps `server-only` to its empty file (it would throw outside Next.js). |
| `tsconfig.json` | TypeScript settings (`strict: true`). |
| `eslint.config.mjs` | Lint rules from Next.js (includes accessibility rules). Ignores the generated `public/ort/` files. |
| `playwright.config.ts` | e2e config: builds, starts on port 3900, runs `e2e/` in Chromium. |
| `.github/workflows/ci.yml` | CI: `npm ci`, `npm audit`, `npm run check`, Playwright install, `npm run test:e2e`. |
| `.npmrc` | `onnxruntime-node-install=skip`: skips an optional, server-only download (CUDA binaries) that the browser AI does not use. |
| `next.config.ts` (Stage 9) | Security headers for every path (CSP without nonces, frame/referrer/permissions/HSTS/COOP), `poweredByHeader: false`, no-cache for `/sw.js`. |
| `.env.example` | Documents that no environment variables are needed. |
| `.gitignore` | Keeps `node_modules`, builds and `.env*` files out of git (except `.env.example`). |
| `CHANGELOG.md` (Stage 10) | Release notes; current version `1.0.0-beta.1`. |
| `docs/DEPLOYMENT.md`, `docs/HANDOFF.md` (Stage 10) | How to deploy, check and roll back; project status, what is verified and what is not, next steps. |
| `AGENTS.md` | Generated by Next.js for AI coding assistants. Safe to keep. |
