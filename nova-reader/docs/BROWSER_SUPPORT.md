# Browser support

| Area | Requirement | Without it |
| --- | --- | --- |
| Core reader | A current version of Chrome, Edge, Firefox or Safari (Safari 15.4+ for the native `<dialog>`; older browsers get a simple fallback) | — |
| Saving and offline copies | IndexedDB (all current browsers). Private-browsing modes may block it | Clear message; reading still works |
| Opening offline | Service worker + HTTPS (or localhost), production build | The app works online only |
| Local AI (CPU) | Web Workers + WebAssembly | Panel explains why; everything else works |
| Local AI (GPU) | WebGPU with `shader-f16`, secure context. Mainly recent Chrome/Edge on desktop; availability varies by device | Falls back to CPU mode |

**Tested automatically:** Chromium (Playwright e2e suite) and jsdom (unit tests). **Not yet tested:** Firefox, Safari, mobile browsers and real devices; please test before release (see `RELEASE_CHECKLIST.md`).
