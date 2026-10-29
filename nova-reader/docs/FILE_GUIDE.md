# File guide (for beginners)

This page explains every file we wrote: what it is for, **where it runs**, and its important functions.

- **Server** means it runs in Node.js on the machine hosting the app (your laptop during `npm run dev`, Vercel after deployment).
- **Browser** means it runs on the user's device.
- **Both** means it is plain TypeScript with no server-only or browser-only code.

---

## app/

### `app/api/feed/route.ts` — Server

The only API endpoint: `GET /api/feed?url=<encoded-feed-url>`. It is three lines: it calls `handleFeedRequest()` from `lib/server/feed-handler.ts`. (Next.js route files may only export HTTP handlers, and keeping the logic in `lib/server/` lets tests pass a fake DNS and network.) There is no `export const runtime`: with Cache Components, Next.js always uses Node.js and forbids that export.

### `app/layout.tsx` — Server

The HTML shell (`<html>`, `<body>`) and page title. Uses system fonts, so no font is downloaded from Google (faster and more private).

### `app/page.tsx` — Browser (`"use client"`)

The main page. It holds the app's **state** and connects all components.

| Function / state | What it does |
| --- | --- |
| `feed`, `status`, `isLoadingFeed` | The loaded feed and the loading/success/error message. |
| `saved`, `savedError` | Saved articles from IndexedDB. |
| `useEffect(...)` | Loads saved articles once when the page opens. |
| `loadFeed(url)` | Refuses when offline; otherwise calls `/api/feed`, checks the JSON with Zod, and shows the feed or an error. |
| `toggleSave(article)` | Saves or removes an article in IndexedDB and updates the list. |

### `app/globals.css` — Browser

Imports Tailwind and defines colour tokens (`--accent`, `--ink`, …) for light and dark mode, a strong keyboard focus ring, and reduced-motion support.

---

## components/ — all Browser

| File | Purpose |
| --- | --- |
| `FeedForm.tsx` | The URL input. `submit()` validates with `validateFeedUrl()` and shows the error under the input (linked with `aria-describedby`). The button is disabled while loading. Has three example feeds. |
| `FeedList.tsx` | Feed title, description, article count, website link, and the list of `ArticleCard`s. Shows an empty state if the feed has no articles. |
| `ArticleCard.tsx` | One article: title, `<time>` date, author, 3-line summary, **Read**, **Save** (`aria-pressed` shows its state) and **Original** link (`rel="noopener noreferrer"`). The `compact` variant is used in the sidebar. |
| `ReaderView.tsx` | The reading view, built on the native `<dialog>`: focus moves into it and **Escape** closes it. Shows `ArticleContent` when the feed sent HTML, otherwise the plain-text summary plus a note that links are not available. |
| `ArticleContent.tsx` | Sanitizes `contentHtml` with `sanitizeArticleHtml()` and inserts the cleaned nodes into an empty `<div>` (`replaceChildren`). Link styles come from `.article-content` in `globals.css`. |
| `SavedArticles.tsx` | The "Saved on this device" section: loading, error, empty and list states. |
| `OfflineIndicator.tsx` | Badge showing "Online" or "Offline: saved articles only". `role="status"` makes screen readers announce changes. |
| `AIWorkspacePlaceholder.tsx` | Three inactive cards for future local AI. Makes **no** network calls. |
| `EmptyState.tsx` | A friendly "nothing here yet" box with an icon. |
| `StatusMessage.tsx` | A coloured message. Errors use `role="alert"` (announced immediately); others use `role="status"`. |

**Safety rule used everywhere:** feed content is rendered as text with `{value}` in JSX, so React escapes it. The one exception is article HTML in `ArticleContent`, which is always sanitized by DOMPurify first. We never use `dangerouslySetInnerHTML`.

---

## lib/

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

### `lib/db.ts` — Browser

Dexie database named `nova-reader` with one table, `savedArticles` (primary key `id`, index `savedAt`).

| Function | What it does |
| --- | --- |
| `getSavedArticles()` | All saved articles, newest saved first. |
| `saveArticle(article, feedTitle)` | Stores an article with `savedAt = now`. Saving twice just updates it. |
| `removeSavedArticle(id)` | Deletes one article. |
| `safely(...)` | Wraps every call so failures (for example private browsing) become a friendly `LocalStorageError`. |

### `lib/sanitize-html.ts` — Browser

| Function | What it does |
| --- | --- |
| `sanitizeArticleHtml(html, baseUrl)` | Runs DOMPurify with a short allow-list of reading tags (`p`, `a`, `em`, lists, headings…) and only the `href`/`title` attributes. Returns a `DocumentFragment`. |
| `secureLink(link, baseUrl)` | Resolves the link against the article URL. Keeps it only if it is http(s), otherwise removes `href` (the text stays). Adds `target="_blank"` and `rel="noopener noreferrer nofollow ugc"`. |

### `lib/server/` — Server only

Every file starts with `import "server-only"`, so Next.js fails the build if browser code imports it.

| File | Function | What it does, in plain words |
| --- | --- | --- |
| `feed-handler.ts` | `handleFeedRequest(request, deps?)` | Rate limit → Stage 2 `validateFeedUrl()` → `fetchFeedXml()` → `parseFeedXml()` → JSON. Any error becomes `{ success: false, error: { code, message } }` with a safe message. Unknown errors are logged on the server and the browser only sees "Something went wrong". Adds `no-store`, `nosniff` and CSP headers. |
| `feed-fetcher.ts` | `fetchFeedXml(url, options?)` | One 10-second deadline for everything. For every hop: `assertSafeDestination()`, then one request. Redirects (max 3) are followed by hand. Checks the status (2xx only), the content type (XML types; `text/plain` only if the body is XML) and decodes the charset. |
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
| `ssrf.test.ts` | IP policy (IPv4 + IPv6 special ranges), DNS validation, pinned lookup in both Node modes, DNS-rebinding simulation, port policy. |
| `http-client.test.ts` | Real local HTTP server: body/headers, gzip, redirects not followed, Content-Length limit, streaming limit, gzip bomb, timeout, unknown encoding, refused connection, and proof that the real pinned lookup never lets a request reach 127.0.0.1. |

## Config files

| File | Purpose |
| --- | --- |
| `package.json` | Dependencies and scripts (`dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:run`, `test:watch`). |
| `vitest.config.mts` | Test settings; makes `@/` imports work in tests and maps `server-only` to its empty file (it would throw outside Next.js). |
| `tsconfig.json` | TypeScript settings (`strict: true`). |
| `eslint.config.mjs` | Lint rules from Next.js (includes accessibility rules). |
| `next.config.ts` | Next.js settings generated by `create-next-app`. |
| `.env.example` | Documents that no environment variables are needed. |
| `.gitignore` | Keeps `node_modules`, builds and `.env*` files out of git (except `.env.example`). |
| `AGENTS.md` | Generated by Next.js for AI coding assistants. Safe to keep. |
