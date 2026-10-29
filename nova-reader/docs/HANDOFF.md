# Project handoff — NOVA Reader 1.0.0-beta.1

For whoever runs, demos or continues NOVA Reader (PECathon 2026, PS-003 "Small Web Reader").

## Status in one paragraph

Stages 1–10 are done. The app loads RSS/Atom feeds through a protected server route, shows clean full articles, saves articles and offline copies **only in the browser**, can summarize with an **optional on-device AI**, shows a private **Knowledge Radar**, and opens offline. All automated checks pass. It's **ready for a beta** on HTTPS hosting. It hasn't yet been tried against the real internet, the real AI model, or browsers other than Chromium; the manual checklist covers those.

## What each stage delivered

| Stage | Delivered | Main files |
| --- | --- | --- |
| 1 | App shell, feed form, layout | `app/page.tsx`, `components/FeedForm.tsx` |
| 2 | URL validation (browser + server), error codes | `lib/validation.ts`, `lib/feed-types.ts` |
| 3 | RSS/Atom parser with limits | `lib/feed-parser.ts` |
| 4 | `/api/feed` with SSRF protection, limits, rate limit | `lib/server/*` |
| 5 | Saved articles + offline feed copies (IndexedDB) | `lib/db.ts`, `components/SavedArticles.tsx`, `OfflineCopies.tsx` |
| 6 | Full-article reader | `app/api/article`, `lib/article-extractor.ts`, `lib/sanitize-html.ts`, `components/ReaderView.tsx` |
| 7 | Optional local AI summaries | `lib/ai/*`, `workers/ai.worker.ts`, `components/AIWorkspace.tsx`, `LocalSummary.tsx` |
| 8 | Personal Knowledge Radar | `app/radar`, `lib/radar.ts`, `components/radar/*` |
| 9 | Hardening: error pages, redacted logs, CSP/headers, service worker, accessibility, bundle size, e2e tests, CI | `lib/app-errors.ts`, `lib/log.ts`, `next.config.ts`, `public/sw.js`, `e2e/*` |
| 10 | Release validation: regression tests, sanitizer fix, deployment guide, docs, version | `tests/release-regressions.test.ts`, `docs/DEPLOYMENT.md`, `CHANGELOG.md` |

## Verified vs not verified

**Verified** (automated, in a sandbox without internet):

- Unit and component tests: 22 files, 470 tests
- Typecheck, lint and production build
- 12 Chromium browser tests
- `npm audit`: 0 vulnerabilities
- A clean `npm ci` → build → `npm start`, checked with `curl`

**Not verified:**

- Real feeds and articles from the internet (all network tests use fakes that still run the real SSRF checks)
- Downloading and running the real AI model (huggingface.co was blocked)
- Firefox, Safari, mobile browsers and screen readers
- An actual Vercel deployment and the GitHub Actions run
- The Docker route (no Docker Hub access, so no Dockerfile is shipped)

## How to run

```bash
npm ci
npm run dev          # http://localhost:3000
npm run check        # lint + typecheck + unit tests + build
npm run test:e2e     # first time: npx playwright install chromium
```

Deploying: `docs/DEPLOYMENT.md`. Release steps: `docs/RELEASE_CHECKLIST.md`.

## Known limits (accepted for the beta)

- The CSP allows inline scripts, which Next.js static pages need.
- The rate limiter is per server instance and in memory.
- SSRF protection is in code only. Self-hosters should add an egress firewall.
- One feed at a time: there are no subscriptions or unified timeline yet.
- AI summaries cover only the first ~2,000 characters and work best in English.

Details: `docs/SECURITY.md`, `docs/PRIVACY.md`, `docs/BROWSER_SUPPORT.md`.

## Repository note (CI)

`.github/workflows/ci.yml` assumes `nova-reader` is the repository root. If your Git repository is the parent folder (`PECathon/`), move the workflow to `PECathon/.github/workflows/ci.yml` and uncomment the `defaults.run.working-directory: nova-reader` lines.

## Suggested next steps (after the beta, not part of Stage 10)

Listed in the README under "Future GitHub issues". In short: subscriptions + timeline, read/unread, feed autodiscovery, shared rate limiter, egress firewall, encrypted export.
