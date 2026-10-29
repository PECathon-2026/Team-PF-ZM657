// Copies the ONNX Runtime WebAssembly engine files from node_modules into
// public/ort/, so the browser loads them from OUR site instead of a CDN.
// Runs automatically before `npm run dev` and `npm run build` (see package.json).
// The copied files are build output and are ignored by git.

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "onnxruntime-web", "dist");
const target = join(root, "public", "ort");

// The two variants Transformers.js chooses between (see lib/ai/worker-logic.ts).
const FILES = [
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
];

if (!existsSync(source)) {
  console.warn("[copy-onnx-wasm] onnxruntime-web is not installed; local AI will not work.");
  process.exit(0);
}
mkdirSync(target, { recursive: true });
for (const file of FILES) copyFileSync(join(source, file), join(target, file));
console.log(`[copy-onnx-wasm] copied ${FILES.length} files to public/ort/`);
