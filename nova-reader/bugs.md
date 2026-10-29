# Bugs found during backend QA (nova-reader)

Application code in `app/` and `lib/` was not changed. Failures that were test mistakes were fixed in `tests/` only. The items below are real (or likely) product bugs.

> **Tracker update — 2026-10-30 (bug-fix pass on 1.0.0-beta.1)**
>
> | # | Bug | Status |
> | --- | --- | --- |
> | 1 | `truncate()` mis-handles `maxLength` below 1 | **Fixed and verified** |
> | 2 | HTML sanitizer very slow on deeply nested markup | **Fixed and verified** (Chromium + jsdom); Firefox/Safari not tested |
> | NEW-1 | `htmlToText()` is quadratic on many unclosed `<script` tags (server-side CPU stall) | **Still open**, found during this pass, not fixed (out of scope) |
> | NEW-2 | `truncate()` can cut an emoji in half | **Still open**, found during this pass, low impact |
>
> **Note on the QA notes above:** the repository received for this pass did **not** contain `tests/utils.test.ts`. The 20 s timeout change in `tests/release-regressions.test.ts` wasn't there either: the test still uses the default 5 s timeout. That's no longer needed, because it now takes about 15 ms. This pass added `tests/utils.test.ts` itself.

## 1. `truncate()` mis-handles `maxLength` below 1

- **File / function:** `lib/utils.ts` — `truncate(text, maxLength)`
- **Expected:** Cutting to length 0 (or a negative max) should return an empty string, or the function should treat `maxLength < 1` as invalid and not invent extra characters.
- **Actual:** When `text.length > maxLength` it always does `text.slice(0, maxLength - 1).trimEnd() + "…"`. For `maxLength === 0` that is `slice(0, -1)`, which drops only the last character of a longer string and then appends an ellipsis (`truncate("hello", 0)` → `"hell…"`). `truncate("a", 0)` → `"…"`.
- **Steps to reproduce:**
  1. In a Node/Vitest session, `import { truncate } from "@/lib/utils"`.
  2. Call `truncate("hello", 0)` and `truncate("a", 0)`.
  3. Observe `"hell…"` and `"…"` instead of `""`.
- **Notes:** Existing parser call sites use positive limits (title 500, etc.), so this may not show in the UI today. Covered by `tests/utils.test.ts`.

### Resolution — Fixed and verified

- **Reproduced:** `truncate("hello", 0)` → `"hell…"`, `truncate("a", 0)` → `"…"`. Also wrong for limits the report didn't list:

  | Call | Result |
  | --- | --- |
  | `truncate("hello", -3)` | `"h…"` |
  | `truncate("hello", NaN)` | `"…"` |
  | `truncate("hello", 2.5)` | `"h…"` (by accident) |

- **Root cause:** the function assumed `maxLength >= 1`. With 0 or a negative number, `slice(0, maxLength - 1)` counts from the *end* of the string. With `NaN`, the `length <= maxLength` check is always false.
- **Fix:** round the limit down; a limit below 1 (or `NaN`) returns `""`. Positive limits behave exactly as before, and the result is never longer than the limit.
- **Impact today:** none visible. Every call site passes a positive constant (`feed-parser.ts`, `article-extractor.ts`).
- **Regression tests:** `tests/utils.test.ts` (8 tests). 3 of them fail on the old code and pass on the fix.

## 2. HTML sanitizer is very slow on deeply nested markup

- **File / function:** `lib/sanitize-html.ts` — `sanitizeArticleHtml()` (DOMPurify)
- **Expected:** Pathological but bounded HTML (for example 2,000 nested `<div>`s) should be sanitized in well under a second, or rejected as too complex, so a crafted feed cannot stall the tab.
- **Actual:** `sanitizeArticleHtml` on `"<div>".repeat(2000) + "deep" + "</div>".repeat(2000)` often takes several seconds. Under a full Vitest run (many workers) the existing 5s test `survives malformed and deeply nested input without throwing` times out. Isolated, it usually finishes.
- **Steps to reproduce:**
  1. Run `npx vitest run tests/release-regressions.test.ts` (usually passes).
  2. Run `npm test` with the larger suite so many jsdom workers run at once.
  3. Watch `HTML sanitizer edge cases > survives malformed and deeply nested input without throwing` hit the default 5s timeout.
- **Notes:** The test timeout in `tests/release-regressions.test.ts` was raised to 20s so the suite is not flaky. The slowness itself is unchanged. No application code was modified.

### Resolution — Fixed and verified (Chromium + jsdom)

**Reproduced and measured.** The proposed diagnosis (DOMPurify is slow) turned out to be only partly right.

| Input | Environment | Total | HTML parsing alone |
| --- | --- | --- | --- |
| 2,000 levels | jsdom | 779 ms | 545 ms |
| 2,000 levels | real Chromium | 44 ms | — |
| 16,000 levels | real Chromium | — | 1,233 ms |
| ~3 MB page of nesting | real Chromium | did not finish in 3 minutes | — |

**Root cause.**

- The time goes into the HTML *parser* (jsdom's, and the browser's own `DOMParser`), not into DOMPurify itself.
- Chromium caps DOM depth at about 512. Beyond that, parsing becomes roughly quadratic.
- The same number of elements without nesting parses in linear time.
- So no DOMPurify setting can fix this. The input has to be checked *before* it's parsed.

**Same root cause, second place (worse).** `lib/article-extractor.ts` passes the downloaded article page (up to 3 MB) to `DOMParser`. Its existing "too complex" guard (`maxElemsToParse`) only runs *after* parsing, so it came too late. A 3 MB page of nesting froze the real browser tab for more than a minute (see the e2e result below).

**Fix.**

- New `lib/html-limits.ts`, with `isHtmlTooDeeplyNested(html)`. It's a single left-to-right scan using only `indexOf`, so no regular-expression backtracking: about 4–130 ms for 3 MB of hostile input.
- It estimates nesting depth and refuses anything deeper than 500. That's below Chromium's cap, where parsing is still fast.
- Void tags, self-closing tags, tags whose end tag is optional (`p`, `li`, `td`…), comments, and script/style content are not counted. That way ordinary pages are never flagged.

**How each place uses it.**

- `sanitizeArticleHtml()`: too-deep HTML is never parsed. It's shown as plain paragraphs (text only, via `textContent`), so the reader still sees the words. Links from that one article are lost; that's acceptable for hostile markup.
- `extractReadableArticle()`: too-deep pages return the existing `TOO_COMPLEX` failure before parsing. The reader keeps the feed text and shows the existing "too large or complex" message.
- Unchanged: the DOMPurify allow-list, link checks and all other sanitizing. Normal content goes through exactly the same path as before.

**Verification.**

- **Unit tests:** `tests/html-limits.test.ts` (13 tests).
  - The depth limit boundary, unclosed tags, no false positives on the article fixture and long flat articles, void/optional tags, comments/scripts/styles, broken input, and 3 MB hostile inputs.
  - The sanitizer handles 2,000 levels in about 4 ms and the largest allowed feed content (200,000 characters, about 18,000 levels) in about 70 ms. The fallback is safe text only, and normal links still work.
  - The extractor rejects a 550 KB nested page in under 0.2 s, and normal articles still extract.
  - The timing budgets are deliberately generous (3 s), so a busy machine can't make them flaky.
- **Real browser:** `e2e/deep-nesting.spec.ts` (Playwright, Chromium). It uses a feed item with 18,000 nested levels plus a 3 MB nested article page.
  - Fixed code: the text shows, the "too complex" message shows, and the dialog closes. It took 1.8 s in total.
  - Old code: the same test failed after 1.1 minutes, because the tab froze.
- **The original QA test:** `release-regressions › survives malformed and deeply nested input` now takes about 15 ms, within the default 5 s timeout. The full suite was run 3 times with no timeouts.
- **Not tested:** Firefox and Safari. Their parsers have different depth limits, but the check runs before any parser, so the fix doesn't depend on the browser.

## New issues found during this pass (not fixed)

### NEW-1. `htmlToText()` is quadratic on many unclosed `<script` / `<style` tags — Still open (high priority)

- **File / function:** `lib/utils.ts` — `htmlToText()`, first replace: `/<(script|style|iframe|noscript|template)[\s\S]*?<\/\1>/gi`.
- **Actual:** for every `<script` that has no closing tag, the lazy `[\s\S]*?` scans to the end of the text. For example, `"<script".repeat(n)`:

  | n | Characters | Time |
  | --- | --- | --- |
  | 5,000 | 35 K | 0.3 s |
  | 10,000 | 70 K | 1.4 s |
  | 20,000 | 140 K | 5.3 s |

- **Why it matters:** `htmlToText()` runs **on the server** in `lib/feed-parser.ts` for every item's content. Feeds can be up to 2 MB, so one crafted feed could keep the server's CPU busy for minutes (a denial of service). It also runs in the browser, including the new plain-text fallback for bug #2.
- **Steps to reproduce:** `htmlToText("<script".repeat(20000))` in Node takes about 5 s.
- **Suggested fix (not done):** replace that regex with an `indexOf`-based scan, or cap the input length before the replace. Add a timing test. It wasn't fixed here because it's a separate function and code path from the two reported bugs; please confirm before it's changed.

### NEW-2. `truncate()` can cut an emoji (surrogate pair) in half — Still open (low)

- **Actual:** `truncate("ab😀cd", 4)` → `"ab\ud83d…"`, which leaves half of the emoji. Browsers show a broken-character box.
- **Impact:** cosmetic. It only happens when a title, author or summary is cut exactly inside an emoji or another non-BMP character.
- **Suggested fix (not done):** if the last kept character is a high surrogate, drop it.
