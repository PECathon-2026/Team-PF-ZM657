// Detects whether this browser can run local AI (Stage 7). Runs in the BROWSER.
//
// Required: Web Workers + WebAssembly (the CPU path).
// Optional: WebGPU (faster). It needs a secure context (HTTPS or localhost),
// a browser that exposes navigator.gpu, a GPU adapter, and 16-bit float support.
// Every check is wrapped so that a missing or broken API means "not available",
// never an error that breaks the page.

import { LOCAL_AI_MODEL, type AiDevice } from "./config";

export type LocalAiSupport =
  | {
      supported: true;
      device: AiDevice; // the device we will use
      webgpu: { available: boolean; reason?: string };
      approxDownloadMB: number;
      lowMemory: boolean; // device reports < 4 GB RAM
    }
  | { supported: false; reason: string };

/** What the detector looks at. Defaults to the real browser; tests pass fakes. */
export type CapabilityEnvironment = {
  hasWorker: boolean;
  hasWebAssembly: boolean;
  isSecureContext: boolean;
  gpu?: { requestAdapter: () => Promise<{ features: { has: (name: string) => boolean } } | null> };
  deviceMemoryGB?: number;
};

export function browserEnvironment(): CapabilityEnvironment {
  const nav = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { gpu?: unknown; deviceMemory?: number });
  return {
    hasWorker: typeof Worker !== "undefined",
    hasWebAssembly: typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function",
    isSecureContext: typeof isSecureContext === "boolean" ? isSecureContext : false,
    gpu: nav?.gpu as CapabilityEnvironment["gpu"],
    deviceMemoryGB: typeof nav?.deviceMemory === "number" ? nav.deviceMemory : undefined,
  };
}

/** Never throws. WebGPU problems only switch the device to the CPU path. */
export async function detectLocalAiSupport(
  env: CapabilityEnvironment = browserEnvironment(),
  gpuTimeoutMs = 3_000,
): Promise<LocalAiSupport> {
  if (!env.hasWorker) return { supported: false, reason: "This browser does not support Web Workers, which local AI needs." };
  if (!env.hasWebAssembly) return { supported: false, reason: "This browser does not support WebAssembly, which local AI needs." };

  const webgpu = await detectWebGpu(env, gpuTimeoutMs);
  const device: AiDevice = webgpu.available ? "webgpu" : "wasm";
  return {
    supported: true,
    device,
    webgpu,
    approxDownloadMB: LOCAL_AI_MODEL.variants[device].approxDownloadMB,
    lowMemory: env.deviceMemoryGB !== undefined && env.deviceMemoryGB < 4,
  };
}

async function detectWebGpu(env: CapabilityEnvironment, timeoutMs: number): Promise<{ available: boolean; reason?: string }> {
  if (!env.isSecureContext) return { available: false, reason: "WebGPU needs a secure (HTTPS) connection." };
  if (!env.gpu || typeof env.gpu.requestAdapter !== "function") {
    return { available: false, reason: "This browser does not support WebGPU." };
  }
  try {
    const adapter = await Promise.race([
      env.gpu.requestAdapter(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!adapter) return { available: false, reason: "No compatible graphics adapter was found." };
    if (!adapter.features?.has?.("shader-f16")) {
      return { available: false, reason: "The graphics adapter does not support 16-bit numbers (shader-f16)." };
    }
    return { available: true };
  } catch {
    return { available: false, reason: "WebGPU could not be started on this device." };
  }
}
