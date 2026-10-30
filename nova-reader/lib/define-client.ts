// Client helper for looking up word meanings via POST /api/define, with session caching.

import type { WordExplanation } from "@/app/api/define/route";

export type DefineResult =
  | { ok: true; explanation: WordExplanation }
  | { ok: false; message: string };

const defineCache = new Map<string, WordExplanation>();

export async function lookupWordMeaning(
  word: string,
  options: { contextSentence?: string; targetLang?: string; signal?: AbortSignal } = {},
): Promise<DefineResult> {
  const cleaned = word.trim();
  if (!cleaned) {
    return { ok: false, message: "Enter or highlight a word to explain." };
  }

  const cacheKey = `${options.targetLang ?? "en"}::${cleaned.toLowerCase()}::${options.contextSentence ?? ""}`;
  const cached = defineCache.get(cacheKey);
  if (cached) {
    return { ok: true, explanation: cached };
  }

  try {
    const response = await fetch("/api/define", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        word: cleaned,
        contextSentence: options.contextSentence,
        targetLang: options.targetLang,
      }),
      signal: options.signal,
    });

    const data = (await response.json()) as
      | { success: true; explanation: WordExplanation }
      | { success: false; error?: { message?: string } };

    if (!response.ok || !data.success) {
      return {
        ok: false,
        message: (!data.success && data.error?.message) || "Could not explain this word right now.",
      };
    }

    defineCache.set(cacheKey, data.explanation);
    return { ok: true, explanation: data.explanation };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, message: "Lookup cancelled." };
    }
    return { ok: false, message: "Could not reach the word assistant. Check your connection." };
  }
}
