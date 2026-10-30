// Client-side helper for translating article titles, summaries, and body text
// via our own /api/translate route (preserving strict first-party CSP).

export type TranslateResult =
  | { ok: true; translatedText: string; detectedSourceLang?: string }
  | { ok: false; message: string };

const translationCache = new Map<string, { translatedText: string; detectedSourceLang?: string }>();

export async function translateText(
  text: string,
  targetLang: string,
  options?: { isHtml?: boolean; sourceLang?: string | null; signal?: AbortSignal },
): Promise<TranslateResult> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, translatedText: "" };

  const cacheKey = `${targetLang}:${options?.isHtml ? "html" : "txt"}:${trimmed.slice(0, 200)}:${trimmed.length}`;
  const cached = translationCache.get(cacheKey);
  if (cached) return { ok: true, ...cached };

  try {
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: trimmed.slice(0, 25_000),
        targetLang,
        sourceLang: options?.sourceLang ?? undefined,
        isHtml: Boolean(options?.isHtml),
      }),
      signal: options?.signal,
    });

    const data = (await response.json().catch(() => null)) as
      | { success: true; translatedText: string; detectedSourceLang?: string }
      | { success: false; error?: { message?: string } }
      | null;

    if (!response.ok || !data || !data.success) {
      const msg = data && !data.success && data.error?.message
        ? data.error.message
        : `Translation failed (HTTP ${response.status}).`;
      return { ok: false, message: msg };
    }

    const entry = {
      translatedText: data.translatedText,
      detectedSourceLang: data.detectedSourceLang,
    };
    translationCache.set(cacheKey, entry);
    return { ok: true, ...entry };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, message: "Translation cancelled." };
    }
    return {
      ok: false,
      message: "Could not reach the translation service. Check your connection and try again.",
    };
  }
}
