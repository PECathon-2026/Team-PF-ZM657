// Preparing text FOR the model and checking text FROM the model (Stage 7).
// Runs on BOTH sides. Pure functions.

import { htmlToText, normalizeWhitespace } from "@/lib/utils";
import { LOCAL_AI_MODEL } from "./config";

export type PreparedInput = { ok: true; text: string; truncated: boolean } | { ok: false };

/**
 * Turns article content into model input: plain text, whitespace cleaned,
 * cut at a sentence end before the model's limit, with the task prefix.
 */
export function prepareSummaryInput(content: string, isHtml: boolean): PreparedInput {
  const plain = normalizeWhitespace(isHtml ? htmlToText(content) : content);
  if (plain.length < LOCAL_AI_MODEL.minInputChars) return { ok: false };

  let text = plain;
  let truncated = false;
  if (text.length > LOCAL_AI_MODEL.maxInputChars) {
    truncated = true;
    const cut = text.slice(0, LOCAL_AI_MODEL.maxInputChars);
    const lastSentenceEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    text = lastSentenceEnd > LOCAL_AI_MODEL.maxInputChars / 2 ? cut.slice(0, lastSentenceEnd + 1) : cut;
  }
  return { ok: true, text: LOCAL_AI_MODEL.inputPrefix + text, truncated };
}

export const MAX_SUMMARY_LENGTH = 1_500;
export const MIN_SUMMARY_LENGTH = 15;

export type SummaryCheck = { ok: true; text: string } | { ok: false; reason: string };

/**
 * Checks AI output before it is shown. The summary is always displayed as
 * plain text (never as HTML), but we also reject output that is empty, too
 * long, mostly non-text, or stuck in a repetition loop.
 */
export function validateSummary(raw: unknown): SummaryCheck {
  if (typeof raw !== "string") return { ok: false, reason: "not text" };
  // Remove control characters and anything that looks like markup.
  const text = normalizeWhitespace(raw.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ").replace(/<[^>]*>/g, " "));

  if (text.length < MIN_SUMMARY_LENGTH) return { ok: false, reason: "too short" };
  if (text.length > MAX_SUMMARY_LENGTH) return { ok: false, reason: "too long" };

  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (letters / text.length < 0.5) return { ok: false, reason: "mostly not words" };

  if (isRepetitive(text)) return { ok: false, reason: "repetition loop" };

  // T5 often starts in lower case; make the first letter upper case.
  return { ok: true, text: text.charAt(0).toUpperCase() + text.slice(1) };
}

function isRepetitive(text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length < 12) return false;
  const counts = new Map<string, number>();
  for (let i = 0; i + 2 < words.length; i++) {
    const trigram = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
    const count = (counts.get(trigram) ?? 0) + 1;
    if (count >= 4) return true;
    counts.set(trigram, count);
  }
  return new Set(words).size / words.length < 0.3;
}
