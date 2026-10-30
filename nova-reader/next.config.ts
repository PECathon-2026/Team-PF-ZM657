// Next.js configuration. Runs at BUILD time and on the SERVER.
// Stage 9 adds production security headers for every page and file.

import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
const allowPreviewFrame =
  isDev || Boolean(process.env.APP_URL) || process.env.DISABLE_HMR === "true";

// Content-Security-Policy WITHOUT nonces (Next.js 16 guide: "Without Nonces").
// Nonces would force every page to be rendered per request; our pages are static.
//   script-src  'unsafe-inline' is needed for Next.js's inline bootstrap scripts;
//               'wasm-unsafe-eval' lets the local AI run WebAssembly;
//               blob: is used by ONNX Runtime to start its engine.
//   connect-src our own API + the Hugging Face hosts the model is downloaded from
//               (only contacted after the user enables local AI).
//   img-src     no remote images (privacy: blogs cannot track readers).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' blob: data: https://huggingface.co https://*.huggingface.co https://*.hf.co${isDev ? " ws: wss: http://localhost:*" : ""}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(allowPreviewFrame ? [] : ["frame-ancestors 'none'"]),
  "manifest-src 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  ...(allowPreviewFrame ? [] : [{ key: "X-Frame-Options", value: "DENY" }]),
  // Never tell the blogs a reader clicks through to that they came from NOVA Reader.
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Browsers ignore HSTS on plain http (e.g. localhost); it applies once deployed on HTTPS.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false, // do not advertise the framework in every response
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The service worker must always be re-checked so updates arrive quickly.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
