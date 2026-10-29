# Deployment guide (beta)

NOVA Reader is a normal Next.js 16 app. It needs **no database, no environment variables and no secrets**. Two ways to host it are described below.

> Tested in the sandbox: a clean `npm ci` → `npm run build` → `npm start` on Node 22, then a check of the security headers, the safe API errors, `/sw.js` and the `/ort/` engine files.
> **Not tested:** an actual Vercel deployment or a real reverse proxy (no access from the sandbox). Do the "After deploying" checks below on the real site.

## Requirements

- Node.js **20.9 or newer** (22 LTS recommended). `package.json` → `engines` says the same.
- npm, using the committed `package-lock.json` (`npm ci`, not `npm install`, on servers).
- **HTTPS.** The service worker (offline mode) and HSTS only work on HTTPS. Plain `http://localhost` is fine for testing.
- Outbound internet access from the server (it downloads the feeds and articles users ask for).

## Option A: Vercel (recommended for the beta)

1. Push the repository to GitHub.
2. In Vercel, choose **Add New → Project** and import the repository.
3. **Root Directory:** if `nova-reader` is a sub-folder of your repository (for example inside `PECathon/`), set Root Directory to `nova-reader`. Otherwise leave it empty.
4. Leave the defaults: Framework **Next.js**, Build command `npm run build`, Install command `npm ci` or automatic. Add **no** environment variables.
5. Deploy. `npm run build` first runs `scripts/copy-onnx-wasm.mjs` (the `prebuild` step), which copies the local-AI engine into `public/ort/`.

Why Vercel fits: it sets `x-forwarded-for` itself, so the rate limiter sees real client IPs, and it serves HTTPS automatically.

## Option B: your own server (Node.js)

```bash
npm ci
npm run build
PORT=3000 npm start        # Windows PowerShell: $env:PORT=3000; npm start
```

Put it behind an HTTPS reverse proxy (for example Caddy or nginx). Two settings matter:

- The proxy must **replace** (not append to) the `X-Forwarded-For` header with the real client IP. Otherwise clients can fake it and get around the rate limit.
- Don't strip the app's response headers (`Content-Security-Policy`, `Strict-Transport-Security` and the others).

Use a process manager (systemd, pm2 or your platform's equivalent) so the server restarts after a crash.

**Firewall (important for self-hosting):** block outbound connections from the server to private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, `fc00::/7`, `fe80::/10`). The code already blocks these, but a firewall is the second lock. See `SECURITY.md`.

Don't set `HTTP_PROXY`/`HTTPS_PROXY` for the app process: an outbound proxy bypasses the DNS pinning in `lib/server/ssrf.ts`.

## After deploying (5-minute check)

Replace `https://your-site` with your address.

```bash
curl -sI https://your-site/ | grep -iE "content-security|strict-transport|referrer|x-frame"
curl -s  https://your-site/api/does-not-exist          # → {"success":false,"error":{"code":"NOT_FOUND",...}}
curl -s "https://your-site/api/feed?url=http://127.0.0.1/"   # → BLOCKED_HOST
curl -sI https://your-site/sw.js | grep -i cache-control      # → no-cache, no-store, must-revalidate
```

Then open the site in a browser and work through the **Manual** section of `RELEASE_CHECKLIST.md`.

## Updating and rolling back

- **Update:** deploy the new commit. If you changed caching rules in `public/sw.js`, bump its `VERSION` so browsers drop old caches.
- **Roll back on Vercel:** Deployments → pick the previous one → **Promote to Production** (instant).
- **Roll back on your own server:** check out the previous tag, then `npm ci && npm run build` and restart.
- User data lives only in each user's browser (IndexedDB), so deploying or rolling back never deletes saved articles. The database schema is version 3; don't lower it in a rollback.

## Known limits of the beta deployment

- The rate limiter keeps its counters in memory **per server instance** (30 requests/minute per client). With several instances or serverless scaling, the real limit is higher. Use a shared store before a large public launch.
- There are no server logs of URLs or article contents, by design. Errors are one redacted line (`[nova:<scope>] CODE ...`) in the platform's log view.
