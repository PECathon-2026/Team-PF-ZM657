// Settings for the local AI model (Stage 7). Runs on BOTH sides (constants only).
//
// The model is downloaded from the public Hugging Face Hub ONLY after the user
// presses "Download & enable local AI". It is cached in the browser's Cache
// Storage ("transformers-cache"). Article text never leaves the device.

export type AiDevice = "webgpu" | "wasm";

export type ModelVariant = {
  device: AiDevice;
  dtype: "q8" | "fp16"; // q8 = 8-bit quantized (small), fp16 = 16-bit floats (GPU)
  approxDownloadMB: number; // model files only, measured on huggingface.co
};

export const LOCAL_AI_MODEL = {
  id: "Xenova/t5-small",
  displayName: "T5 small (summarization)",
  license: "Apache-2.0",
  task: "summarization",
  // T5 is a multi-task model; this prefix tells it which task to do.
  inputPrefix: "summarize: ",
  // T5-small reads at most 512 tokens (~2,000 characters of English).
  maxInputChars: 2_000,
  minInputChars: 200,
  maxNewTokens: 120,
  variants: {
    // encoder_model_quantized.onnx 35.6 MB + decoder_model_merged_quantized.onnx 42.4 MB + tokenizer/config ~2 MB
    wasm: { device: "wasm", dtype: "q8", approxDownloadMB: 80 },
    // encoder_model_fp16.onnx 70.8 MB + decoder_model_merged_fp16.onnx 83.6 MB + ~2 MB
    webgpu: { device: "webgpu", dtype: "fp16", approxDownloadMB: 156 },
  } satisfies Record<AiDevice, ModelVariant>,
} as const;

/** ONNX Runtime's WebAssembly engine is served from our own site (see scripts/copy-onnx-wasm.mjs). */
export const ORT_WASM_PATH_PREFIX = "/ort/";

/** The Cache Storage name Transformers.js uses for downloaded model files. */
export const MODEL_CACHE_NAME = "transformers-cache";

/** A summary that takes longer than this is stopped. */
export const SUMMARY_TIMEOUT_MS = 120_000;
