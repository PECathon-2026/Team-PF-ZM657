# Beta release checklist

## Automated (must be green)

- [ ] `npm ci`
- [ ] `npm audit --omit=dev`: no high or critical issues
- [ ] `npm run check`: lint, typecheck, unit tests, build
- [ ] `npx playwright install chromium` (first time) then `npm run test:e2e`: smoke, security headers + CSP, no third-party requests, axe accessibility (light + dark), keyboard, offline via service worker
- [ ] GitHub Actions CI passes on the release commit

## Manual (on the deployed HTTPS site)

- [ ] Load 3–5 real feeds (RSS and Atom, e.g. the example buttons), including one that redirects
- [ ] Open full articles from at least two different sites; check the fallback on a PDF link
- [ ] Save, reload, go offline (DevTools → Network → Offline), reload: the app opens with saved articles and the offline copy
- [ ] Local AI: download, summarize, Stop, Delete model, on a desktop with WebGPU and on a phone (CPU)
- [ ] `/radar` shows sensible numbers
- [ ] Firefox, Safari (macOS + iOS), Chrome on Android: core flows
- [ ] Screen reader pass (VoiceOver or NVDA): form, article list, reader dialog, radar tables
- [ ] Response headers on `/` include CSP, HSTS, `no-referrer` (check with `curl -I`)

## Production setup

- [ ] HTTPS only (HSTS is sent)
- [ ] Egress firewall / VPC rules for SSRF (see `SECURITY.md`)
- [ ] Shared rate limiter if running more than one instance
- [ ] No environment variables or secrets needed; `.env.example` documents this
- [ ] After changing caching rules in `public/sw.js`, bump `VERSION`
