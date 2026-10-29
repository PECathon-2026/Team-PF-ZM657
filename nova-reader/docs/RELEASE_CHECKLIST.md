# Beta release checklist

Release: **1.0.0-beta.1**. Tick each box on the release commit. "Sandbox result" is what was verified while preparing this release, in a sandbox **without internet access**.

## Automated (must be green)

| Step | Sandbox result (2026-10-30) |
| --- | --- |
| [ ] `npm ci` on a clean copy | ✅ passed (Node 22) |
| [ ] `npm audit --omit=dev`: no high or critical issues | ✅ 0 vulnerabilities |
| [ ] `npm run check`: lint, typecheck, unit tests, build | ✅ passed, 22 test files / 470 tests |
| [ ] `npx playwright install chromium` (first time), then `npm run test:e2e` | ✅ 12/12 in Chromium |
| [ ] `npm start` on the clean build: headers, JSON 404, `BLOCKED_HOST`, `/sw.js`, `/ort/` files | ✅ checked with `curl` |
| [ ] GitHub Actions CI passes on the release commit | ⬜ not run (needs GitHub; see the CI note in `HANDOFF.md`) |

The e2e suite covers the journey (feed, save, read, radar, 404), security headers and CSP, real API errors, no third-party requests, local AI under the CSP, axe accessibility (light and dark), keyboard use, and opening offline through the service worker.

## Manual (on the deployed HTTPS site)

All of these are ⬜ **not yet done**; they need the real internet or real devices.

- [ ] Run the post-deploy `curl` checks in `DEPLOYMENT.md`
- [ ] Load 3–5 real feeds (RSS and Atom, e.g. the example buttons), including one that redirects
- [ ] Open full articles from at least two different sites; check the fallback on a PDF link
- [ ] Save, reload, go offline (DevTools → Network → Offline), reload: the app opens with saved articles and the offline copy
- [ ] Local AI: download, summarize, Stop, Delete model. Test on a desktop with WebGPU and on a phone (CPU)
- [ ] `/radar` shows sensible numbers
- [ ] Core flows in Firefox, Safari (macOS + iOS) and Chrome on Android
- [ ] Screen reader pass (VoiceOver or NVDA): form, article list, reader dialog, radar tables
- [ ] Replace `docs/screenshot.png` with a screenshot of the deployed app

## Production setup

- [ ] HTTPS only (HSTS is sent)
- [ ] Self-hosting: egress firewall / VPC rules for SSRF, and a proxy that sets `X-Forwarded-For` (see `DEPLOYMENT.md`, `SECURITY.md`)
- [ ] Shared rate limiter if running more than one instance (needed before a large public launch, not for the beta)
- [ ] No environment variables or secrets needed; `.env.example` documents this
- [ ] After changing caching rules in `public/sw.js`, bump `VERSION`
- [ ] Tag the release: `git tag v1.0.0-beta.1`
