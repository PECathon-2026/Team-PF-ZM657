// Language catalog, detection heuristics, and preference helpers.
// Safe to import in both browser and server code.

export type SupportedLanguage = {
  code: string;
  name: string;
  nativeName: string;
};

export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "zh", name: "Chinese", nativeName: "中文" },
  { code: "ar", name: "Arabic", nativeName: "العربية" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
] as const;

export const LANGUAGE_STORAGE_KEY = "nova-preferred-languages-v1";

const KNOWN_CODES = new Set(SUPPORTED_LANGUAGES.map((l) => l.code));

const LANGUAGE_NAMES: Record<string, string> = {
  ...Object.fromEntries(SUPPORTED_LANGUAGES.map((l) => [l.code, l.name])),
  nl: "Dutch",
  sv: "Swedish",
  pl: "Polish",
  tr: "Turkish",
  vi: "Vietnamese",
  id: "Indonesian",
  uk: "Ukrainian",
  bn: "Bengali",
  ta: "Tamil",
  te: "Telugu",
  mr: "Marathi",
};

/** Normalizes a BCP-47 tag such as "en-US" or "zh-Hans" to a lowercase base code ("en", "zh"). */
export function normalizeLangCode(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  const base = trimmed.split(/[-_]/)[0] ?? "";
  return /^[a-z]{2,3}$/.test(base) ? base : null;
}

export function getLanguageName(code: string): string {
  const norm = normalizeLangCode(code) ?? code.toLowerCase();
  return LANGUAGE_NAMES[norm] ?? norm.toUpperCase();
}

export function isSupportedLanguageCode(code: string): boolean {
  return KNOWN_CODES.has(code);
}

const STOPWORDS: Record<string, readonly string[]> = {
  en: ["the", "and", "that", "with", "from", "this", "have", "are", "for", "not", "you", "their", "about", "which", "when"],
  es: ["el", "la", "los", "las", "una", "para", "con", "por", "como", "más", "pero", "sus", "este", "esta", "entre"],
  fr: ["les", "des", "une", "dans", "pour", "avec", "sur", "pas", "plus", "sont", "cette", "aux", "mais", "comme", "tout"],
  de: ["der", "die", "das", "und", "nicht", "mit", "ein", "eine", "auf", "für", "ist", "sich", "auch", "dem", "werden"],
  pt: ["uma", "para", "com", "não", "dos", "das", "mais", "como", "pelo", "pela", "seu", "sua", "nos", "nas", "entre"],
  it: ["che", "non", "per", "una", "con", "del", "della", "sono", "questo", "questa", "anche", "più", "degli", "nel", "alla"],
  nl: ["het", "een", "van", "dat", "niet", "met", "voor", "zijn", "ook", "naar", "maar", "bij", "wordt", "deze"],
};

/**
 * Lightweight, purely local language detector for article titles and bodies.
 * Uses explicit HTML `lang` when valid, then Unicode script checks, then stopword scoring.
 */
export function detectContentLanguage(text: string, declaredLang?: string | null): string | null {
  const declared = normalizeLangCode(declaredLang);
  if (declared) return declared;

  const sample = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1500);
  if (sample.length < 18) return null;

  // Script-level detection for non-Latin writing systems
  const devanagari = (sample.match(/[\u0900-\u097F]/g) ?? []).length;
  if (devanagari >= 4) return "hi";

  const arabic = (sample.match(/[\u0600-\u06FF]/g) ?? []).length;
  if (arabic >= 4) return "ar";

  const hangul = (sample.match(/[\uAC00-\uD7AF]/g) ?? []).length;
  if (hangul >= 3) return "ko";

  const kana = (sample.match(/[\u3040-\u30FF]/g) ?? []).length;
  if (kana >= 3) return "ja";

  const han = (sample.match(/[\u4E00-\u9FFF]/g) ?? []).length;
  if (han >= 4) return "zh";

  const cyrillic = (sample.match(/[\u0400-\u04FF]/g) ?? []).length;
  if (cyrillic >= 5) return "ru";

  // Latin-script stopword frequency scoring
  const tokens = sample
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 2);
  if (tokens.length < 5) return null;

  let bestLang: string | null = null;
  let bestScore = 0;
  let secondScore = 0;

  for (const [lang, words] of Object.entries(STOPWORDS)) {
    const set = new Set(words);
    let hits = 0;
    for (const token of tokens) {
      if (set.has(token)) hits += 1;
    }
    if (hits > bestScore) {
      secondScore = bestScore;
      bestScore = hits;
      bestLang = lang;
    } else if (hits > secondScore) {
      secondScore = hits;
    }
  }

  // Require at least 2 stopword hits and clear lead over runner-up
  if (bestLang && bestScore >= 2 && bestScore > secondScore) {
    return bestLang;
  }

  return null;
}

/** True when `detectedLang` is known and NOT included in the user's preferred language list. */
export function needsTranslation(detectedLang: string | null, preferredLanguages: readonly string[]): boolean {
  if (!detectedLang || preferredLanguages.length === 0) return false;
  const norm = normalizeLangCode(detectedLang);
  if (!norm) return false;
  return !preferredLanguages.some((pref) => normalizeLangCode(pref) === norm);
}
