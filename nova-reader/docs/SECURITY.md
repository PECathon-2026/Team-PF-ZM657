# Security and threat model

NOVA Reader is a **beta**. This page lists what it defends against, what it accepts, and what must still be done before a public production launch. Report security problems privately to the maintainers. Please don't open a public issue for them.

## What the app stores and sends

| Data | Where it lives | Sent to a server? |
| --- | --- | --- |
| Saved articles, offline feed copies, stored full articles | Browser IndexedDB (`nova-reader`) | **Never** |
| Local AI model files | Browser Cache Storage (`transformers-cache`) | Downloaded once from huggingface.co after the user clicks |
| App pages and code | Browser Cache Storage (`nova-sw-v1-*`, service worker) | — |
| A feed or article URL the user asks to load | Sent to **this app's server** (`/api/feed`, `/api/article`), which downloads it | The server does not store or log URLs |
| IP address | Seen by this app's server; rate limiter keeps only a salted hash, in memory, for 1 minute | — |

## Threats and defences

| Threat | Defence | Where |
| --- | --- | --- |
| **SSRF**: tricking the server into calling internal addresses (localhost, private networks, cloud metadata) | URL rules (http/https only, no credentials, web ports only); every IPv4/IPv6 address checked (A + AAAA), blocked if **any** is private; connections pinned to the checked IP (prevents DNS rebinding); every redirect re-checked; max 3 redirects | `lib/server/ssrf.ts`, `feed-fetcher.ts` |
| Huge or slow upstream responses | 10 s overall deadline; 2 MB (feeds) / 3 MB (articles) limit, also after decompression (gzip bombs) | `lib/server/http-client.ts` |
| **XSS** from feed or article HTML | Titles and summaries rendered as text; HTML only after a DOMPurify allow-list (no scripts, styles, handlers, iframes, forms, images); links http(s) only, `rel="noopener noreferrer"`; article pages parsed in an inert `DOMParser` document; API returns pages as JSON data, never as HTML | `lib/sanitize-html.ts`, `lib/article-extractor.ts` |
| Script injection or data exfiltration via the page | **Content-Security-Policy** on every page: `default-src 'self'`, no third-party scripts, connections only to this site and Hugging Face, `object-src 'none'`, `frame-ancestors 'none'`. Zod runs "jitless", so no `eval` is needed | `next.config.ts`, `lib/zod-setup.ts` |
| Clickjacking | `frame-ancestors 'none'` + `X-Frame-Options: DENY` | `next.config.ts` |
| Leaking which articles people read via the Referer header | `Referrer-Policy: no-referrer` + `rel="noreferrer"` on links | `next.config.ts` |
| Information leaks in errors | Stable error codes; friendly messages only; no stack traces, paths, env values or raw upstream errors in responses or UI; JSON 404 for unknown API paths | `lib/app-errors.ts`, `app/error.tsx`, `app/api/[...path]` |
| Secrets or private URLs in logs | One-line logs only: code + redacted message (credentials, query strings, `KEY=value`, bearer tokens and file paths removed; max 200 chars; no article text) | `lib/log.ts` |
| Abuse of the fetch routes | In-memory rate limit, 30 requests/min per client (salted IP hash) | `lib/server/rate-limit.ts` |
| Malicious AI output | Worker messages validated with Zod; summaries must be plain text with sane length and no loops; rendered as text | `lib/ai/*` |
| Supply chain | `npm audit` in CI; ONNX Runtime engine served from this site, not a CDN; versions pinned in `package-lock.json` | `.github/workflows/ci.yml`, `scripts/copy-onnx-wasm.mjs` |

## Accepted risks (beta)

- **CSP allows `'unsafe-inline'` scripts.** Next.js static pages need inline bootstrap scripts, and nonces would make every page dynamic. All other script sources are blocked.
- **The rate limiter is per server instance.** On serverless hosting each instance has its own counter, and the client IP comes from `x-forwarded-for`, which is trustworthy only behind a platform that sets it (Vercel does).
- **No network egress firewall.** Code-level SSRF checks can't cover outbound proxies (`HTTP_PROXY` bypasses DNS pinning), unusual IPv6/NAT64 routing, or a compromised DNS resolver.
- **The fetch routes can reach any public website**, which could be used to hide a requester's IP. Rate limiting reduces but doesn't remove this.
- **Readability can mis-detect content**, which affects what is shown but is still sanitized.
- **The local AI model is downloaded from huggingface.co.** Hugging Face sees the user's IP and the model name, but not what they read.

## Before a public production launch

1. Network egress controls: block private ranges and `169.254.169.254` at the firewall or VPC.
2. A shared rate limiter (Redis/Upstash or a platform firewall) behind the existing `RateLimiter` interface.
3. Consider a nonce- or SRI-based CSP once its trade-offs are acceptable.
4. Run the release checklist (`docs/RELEASE_CHECKLIST.md`).
