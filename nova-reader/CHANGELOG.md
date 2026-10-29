# Changelog

## 1.0.0-beta.1 — 2026-10-30 (Stage 10: release candidate)

First public beta. No new user-facing features in this release; it validates and documents Stages 1–9.

- **Security:** the HTML sanitizer now also removes `data-*` attributes (DOMPurify keeps them by default; found by a new regression test).
- **Tests:** 34 new regression tests (`tests/release-regressions.test.ts`):
  - unusual IP spellings: hex, octal, short forms, one big number, trailing dots, IPv4-mapped/compatible IPv6, NAT64, 6to4, zone IDs
  - cloud metadata hosts, blocked ports, backslash/credential tricks, punycode hosts
  - entity-encoded `javascript:` links, SVG/MathML tricks, remote media/`<base>`/`<meta refresh>`, deeply nested HTML
- **Deployment:** `docs/DEPLOYMENT.md` (Vercel and own-server steps, post-deploy checks, rollback).
- **Docs:** README brought up to date (release status, test counts, finished items removed from "planned"); `docs/HANDOFF.md` (status, verified/unverified, next steps); release checklist updated.
- Version set to `1.0.0-beta.1`.

## Stages 1–9 (0.1.0, development)

1. Next.js app shell, feed URL form, project structure.
2. URL validation (browser + server) and safe API error codes.
3. RSS 2.0 / RSS 1.0 / Atom parser with limits.
4. `/api/feed`: SSRF protection (DNS check + pinned connections), timeouts, size limits, rate limiting.
5. Saved articles and offline feed copies in IndexedDB (Dexie).
6. Full-article reader: `/api/article`, Readability, DOMPurify.
7. Optional local AI summaries in a Web Worker (Transformers.js, T5-small).
8. Personal Knowledge Radar (`/radar`), calculated on the device.
9. Production hardening: error pages and codes, redacted logs, CSP and security headers, service worker (opens offline), accessibility fixes (axe: 0 violations), smaller bundle, Playwright tests, CI, security/privacy docs.
