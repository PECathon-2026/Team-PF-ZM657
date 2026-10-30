// Fast, deterministic on-device extractive summarizer.
// Used both as an instant fallback when neural WebAssembly AI is not downloaded yet
// and as a safety net inside the AI Web Worker when T5 output fails validation.

import { htmlToText, normalizeWhitespace } from "./utils";

const COMMON_STOPWORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "have", "has", "had",
  "are", "was", "were", "been", "being", "will", "would", "could", "should",
  "into", "about", "than", "then", "them", "they", "their", "there", "these",
  "those", "what", "when", "where", "which", "while", "who", "whom", "whose",
  "your", "ours", "more", "most", "some", "such", "only", "other", "over",
  "also", "very", "just", "like", "make", "made", "many", "much", "each",
]);

/**
 * Produces a concise 2–3 sentence plain-text summary directly from article prose
 * using term-frequency + lead-sentence positional weighting.
 */
export function buildExtractiveSummary(content: string, isHtml: boolean, maxSentences = 3): { ok: true; text: string; truncated: boolean } | { ok: false; message: string } {
  const plain = normalizeWhitespace(isHtml ? htmlToText(content) : content);
  if (plain.length < 40) {
    return { ok: false, message: "There is not enough text in this article to summarize." };
  }

  const truncated = plain.length > 8_000;
  const source = truncated ? plain.slice(0, 8_000) : plain;

  // Split into clean sentences across Latin, Devanagari, and CJK punctuation.
  const rawSentences = source
    .split(/(?<=[.!?।！？])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 25);

  if (rawSentences.length === 0) {
    const snippet = source.length > 360 ? `${source.slice(0, 357).trimEnd()}…` : source;
    return { ok: true, text: snippet, truncated };
  }

  if (rawSentences.length <= maxSentences) {
    return { ok: true, text: rawSentences.join(" "), truncated };
  }

  // Word frequency table
  const freq = new Map<string, number>();
  const tokenize = (s: string) =>
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 3 && !COMMON_STOPWORDS.has(w));

  for (const sentence of rawSentences) {
    for (const word of tokenize(sentence)) {
      freq.set(word, (freq.get(word) ?? 0) + 1);
    }
  }

  const scored = rawSentences.map((sentence, index) => {
    const words = tokenize(sentence);
    const wordScore = words.length === 0 ? 0 : words.reduce((sum, w) => sum + (freq.get(w) ?? 0), 0) / Math.sqrt(words.length);
    // Slight lead bias so opening context sentence is favored
    const positionBonus = index === 0 ? 1.35 : index === 1 ? 1.15 : 1;
    // Penalize overly long run-on sentences
    const lengthPenalty = sentence.length > 320 ? 0.75 : 1;
    return { index, sentence, score: wordScore * positionBonus * lengthPenalty };
  });

  const chosen = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.sentence);

  let combined = chosen.join(" ");
  if (combined.length > 900) {
    combined = `${combined.slice(0, 897).trimEnd()}…`;
  }

  return { ok: true, text: combined, truncated };
}
