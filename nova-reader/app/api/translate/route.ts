// POST /api/translate
// Server-side translation endpoint.
// - Uses @google/genai (gemini-3.8-flash) when GEMINI_API_KEY is configured.
// - Automatically falls back to a public translation endpoint when GEMINI_API_KEY
//   is absent (so standalone local / GitHub deployments work with zero secrets).

import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { NextResponse } from "next/server";
import { getLanguageName, normalizeLangCode } from "@/lib/languages";

type TranslateRequestBody = {
  text?: unknown;
  targetLang?: unknown;
  sourceLang?: unknown;
  isHtml?: unknown;
};

const MAX_TEXT_CHARS = 25_000;

export async function POST(request: Request): Promise<Response> {
  let body: TranslateRequestBody;
  try {
    body = (await request.json()) as TranslateRequestBody;
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON request body." } },
      { status: 400 },
    );
  }

  const rawText = typeof body.text === "string" ? body.text.trim() : "";
  const targetLang = normalizeLangCode(typeof body.targetLang === "string" ? body.targetLang : "");
  const sourceLang = normalizeLangCode(typeof body.sourceLang === "string" ? body.sourceLang : "");
  const isHtml = Boolean(body.isHtml);

  if (!rawText) {
    return NextResponse.json(
      { success: false, error: { code: "EMPTY_TEXT", message: "No text provided to translate." } },
      { status: 400 },
    );
  }
  if (!targetLang) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_TARGET_LANG", message: "Please select a valid target language." } },
      { status: 400 },
    );
  }

  const text = rawText.slice(0, MAX_TEXT_CHARS);
  const targetName = getLanguageName(targetLang);

  // 1. Primary path: Gemini API (server-side only) when GEMINI_API_KEY is available.
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (apiKey && apiKey !== "MY_GEMINI_API_KEY") {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      const formatInstruction = isHtml
        ? "Preserve clean HTML paragraph, heading, list, blockquote, and anchor (<a href>) tags without adding scripts or styles."
        : "Return plain text only, preserving paragraph breaks.";

      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: text,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            `You are a precise editorial translator for an RSS reader. Translate the user's article text faithfully into ${targetName} (${targetLang}). ` +
            `${formatInstruction} Also identify the ISO 639-1 source language code.`,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              translatedText: {
                type: Type.STRING,
                description: `The translated content in ${targetName}.`,
              },
              detectedSourceLang: {
                type: Type.STRING,
                description: "Two-letter ISO 639-1 code of the original text.",
              },
            },
            required: ["translatedText"],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? "{}").trim()) as {
        translatedText?: string;
        detectedSourceLang?: string;
      };
      if (parsed.translatedText && parsed.translatedText.trim()) {
        return NextResponse.json({
          success: true,
          translatedText: parsed.translatedText.trim(),
          detectedSourceLang: normalizeLangCode(parsed.detectedSourceLang) ?? sourceLang ?? undefined,
        });
      }
    } catch {
      // Fall through to zero-key fallback if Gemini quota/key is unavailable.
    }
  }

  // 2. Zero-key fallback so GitHub clones without GEMINI_API_KEY still translate cleanly.
  try {
    const fallback = await translateWithoutKey(text, targetLang, sourceLang ?? "auto", isHtml);
    return NextResponse.json({
      success: true,
      translatedText: fallback.translatedText,
      detectedSourceLang: fallback.detectedSourceLang,
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "TRANSLATION_UNAVAILABLE",
          message: "Translation could not be completed right now. Please try again shortly.",
        },
      },
      { status: 502 },
    );
  }
}

async function translateWithoutKey(
  input: string,
  targetLang: string,
  sourceLang: string,
  isHtml: boolean,
): Promise<{ translatedText: string; detectedSourceLang?: string }> {
  // Strip tags into clean paragraphs when falling back so markup isn't mangled.
  const plain = isHtml
    ? input
        .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, "\n\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]*>/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : input;

  const chunks = splitIntoChunks(plain, 1800);
  const translatedChunks: string[] = [];
  let detected: string | undefined;

  for (const chunk of chunks) {
    const url = new URL("https://translate.googleapis.com/translate_a/single");
    url.searchParams.set("client", "gtx");
    url.searchParams.set("sl", sourceLang);
    url.searchParams.set("tl", targetLang);
    url.searchParams.set("dt", "t");
    url.searchParams.set("q", chunk);

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = (await res.json()) as unknown;
    if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
      throw new Error("Unexpected response shape");
    }
    const piece = (payload[0] as unknown[])
      .map((part) => (Array.isArray(part) && typeof part[0] === "string" ? part[0] : ""))
      .join("");
    translatedChunks.push(piece);
    if (!detected && typeof payload[2] === "string") {
      detected = normalizeLangCode(payload[2]) ?? undefined;
    }
  }

  const combined = translatedChunks.join("\n\n").trim();
  if (!isHtml) {
    return { translatedText: combined, detectedSourceLang: detected };
  }

  const htmlParagraphs = combined
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");

  return { translatedText: htmlParagraphs, detectedSourceLang: detected };
}

function splitIntoChunks(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  for (const para of paragraphs) {
    if ((current ? `${current}\n\n${para}` : para).length <= maxLen) {
      current = current ? `${current}\n\n${para}` : para;
    } else {
      if (current) chunks.push(current);
      if (para.length <= maxLen) {
        current = para;
      } else {
        for (let i = 0; i < para.length; i += maxLen) {
          chunks.push(para.slice(i, i + maxLen));
        }
        current = "";
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
