# File guide (for beginners)

This page explains every file we wrote: what it is for, **where it runs**, and its important functions.

- **Server** means it runs in Node.js on the machine hosting the app (your laptop during `npm run dev`, Vercel after deployment).
- **Browser** means it runs on the user's device.
- **Both** means it is plain TypeScript with no server-only or browser-only code.

---

## app/

### `app/api/feed/route.ts` — Server

The only API endpoint: `GET /api/feed?url=<encoded-feed-url>`. Browsers usually cannot download a blog's feed directly (CORS), so the browser asks our server to do it.

| Function | What it does, in plain words |
| --- | --- |
| `GET(request)` | Reads `?url=`, validates it, downloads the feed, parses it, and returns `{ success: true, feed, items }`. Any error becomes `{ success: false, error: { code, message } }`. |
| `downloadFeed(url)` | Downloads the feed. Follows at most 3 redirects **by hand** so each new address is validated (stops `https://evil.example` → `http://localhost`). |
| `fetchOnce(url)` | One request with a 10-second timeout. Connection problems become `FETCH_FAILED`. |
| `readLimitedText(response)` | Reads the body piece by piece and stops when it passes 2 MB. |
| `errorResponse(error)` / `describeError(error)` | Turns any error into a safe JSON message and HTTP status. Stack traces are never sent to the browser. |

Why `rawUrl` is read outside `try`: reading `request.url` tells Next.js "this route is dynamic". Next.js signals that with an internal error during the build, and our `catch` must not swallow it.

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
| `feed-route.test.ts` | The API route with a fake `fetch`: success, missing URL, localhost (no request made), redirect to a private IP, HTTP 404, invalid XML, >2 MB, timeout, network failure without leaking details. |

## Config files

| File | Purpose |
| --- | --- |
| `package.json` | Dependencies and scripts (`dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:watch`). |
| `vitest.config.mts` | Test settings; makes `@/` imports work in tests. |
| `tsconfig.json` | TypeScript settings (`strict: true`). |
| `eslint.config.mjs` | Lint rules from Next.js (includes accessibility rules). |
| `next.config.ts` | Next.js settings generated by `create-next-app`. |
| `.env.example` | Documents that no environment variables are needed. |
| `.gitignore` | Keeps `node_modules`, builds and `.env*` files out of git (except `.env.example`). |
| `AGENTS.md` | Generated by Next.js for AI coding assistants. Safe to keep. |
