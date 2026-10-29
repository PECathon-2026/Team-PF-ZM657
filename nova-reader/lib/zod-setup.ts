// Zod settings shared by every module that defines schemas (Stage 9). Runs on BOTH sides
// and in the AI Web Worker (each bundle has its own copy of Zod, so each imports this).
// Import it for its side effect only:   import "@/lib/zod-setup";
//
// Our Content-Security-Policy forbids eval. Zod 4 otherwise probes `new Function`
// once to compile faster parsers, and the browser reports that probe as a CSP
// violation. "jitless" skips the probe; validation works exactly the same.
//
// (Only the `config` function is imported, so bundlers can leave out the rest of
// Zod, such as its translated error messages, which NOVA Reader does not use.)

import { config } from "zod";

config({ jitless: true });
