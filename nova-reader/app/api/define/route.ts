// POST /api/define
// Server-side AI Word Meaning & Contextual Dictionary Assistant.
// Uses @google/genai (gemini-3.8-flash) when GEMINI_API_KEY is available, with an
// automatic zero-key fallback to Free Dictionary API so GitHub clones work out of the box.

import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { NextResponse } from "next/server";
import { getLanguageName, normalizeLangCode } from "@/lib/languages";

export type WordExplanation = {
  word: string;
  phonetic?: string;
  partOfSpeech?: string;
  meaning: string;
  inContext?: string;
  example?: string;
  synonyms: string[];
};

type DefineRequestBody = {
  word?: unknown;
  contextSentence?: unknown;
  targetLang?: unknown;
};

export async function POST(request: Request): Promise<Response> {
  let body: DefineRequestBody;
  try {
    body = (await request.json()) as DefineRequestBody;
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON request body." } },
      { status: 400 },
    );
  }

  const rawWord = typeof body.word === "string" ? body.word.trim().slice(0, 120) : "";
  const contextSentence = typeof body.contextSentence === "string" ? body.contextSentence.trim().slice(0, 600) : "";
  const targetLang = normalizeLangCode(typeof body.targetLang === "string" ? body.targetLang : "en") ?? "en";

  if (!rawWord) {
    return NextResponse.json(
      { success: false, error: { code: "EMPTY_WORD", message: "Enter or select a word or short phrase to explain." } },
      { status: 400 },
    );
  }

  const targetName = getLanguageName(targetLang);
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

      const prompt = contextSentence
        ? `Word or phrase: "${rawWord}"\nSurrounding article sentence: "${contextSentence}"`
        : `Word or phrase: "${rawWord}"`;

      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            `You are a clear, literary reading companion inside NOVA Reader. Explain the requested word or short phrase in ${targetName} (${targetLang}) ` +
            "using concise, accessible everyday language. If a surrounding sentence is given, also explain what the word specifically conveys in that context.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              word: { type: Type.STRING, description: "Normalized word or phrase being defined." },
              phonetic: { type: Type.STRING, description: "Optional IPA or readable pronunciation guide." },
              partOfSpeech: { type: Type.STRING, description: "Part of speech (noun, verb, adjective, idiom, etc.)." },
              meaning: { type: Type.STRING, description: `Clear plain-language definition in ${targetName}.` },
              inContext: {
                type: Type.STRING,
                description: `1-sentence explanation of how it is used in the given context sentence, in ${targetName}.`,
              },
              example: { type: Type.STRING, description: "One short natural example sentence." },
              synonyms: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Up to 4 helpful synonyms or related terms.",
              },
            },
            required: ["word", "meaning", "synonyms"],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? "{}").trim()) as Partial<WordExplanation>;
      if (parsed.meaning && parsed.meaning.trim()) {
        const result: WordExplanation = {
          word: parsed.word?.trim() || rawWord,
          phonetic: parsed.phonetic?.trim() || undefined,
          partOfSpeech: parsed.partOfSpeech?.trim() || undefined,
          meaning: parsed.meaning.trim(),
          inContext: parsed.inContext?.trim() || undefined,
          example: parsed.example?.trim() || undefined,
          synonyms: Array.isArray(parsed.synonyms)
            ? parsed.synonyms.filter((s): s is string => typeof s === "string" && Boolean(s.trim())).slice(0, 5)
            : [],
        };
        return NextResponse.json({ success: true, explanation: result });
      }
    } catch {
      // Fall through to public dictionary fallback
    }
  }

  // Zero-key dictionary fallback
  try {
    const dictUrl = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(rawWord.toLowerCase())}`;
    const res = await fetch(dictUrl, { signal: AbortSignal.timeout(6_000) });
    if (res.ok) {
      const entries = (await res.json()) as Array<{
        word?: string;
        phonetic?: string;
        meanings?: Array<{
          partOfSpeech?: string;
          synonyms?: string[];
          definitions?: Array<{ definition?: string; example?: string; synonyms?: string[] }>;
        }>;
      }>;
      const first = entries[0];
      const firstMeaning = first?.meanings?.[0];
      const firstDef = firstMeaning?.definitions?.[0];
      if (firstDef?.definition) {
        const syns = [...(firstDef.synonyms ?? []), ...(firstMeaning?.synonyms ?? [])].slice(0, 4);
        const explanation: WordExplanation = {
          word: first?.word ?? rawWord,
          phonetic: first?.phonetic,
          partOfSpeech: firstMeaning?.partOfSpeech,
          meaning: firstDef.definition,
          example: firstDef.example,
          synonyms: syns,
        };
        return NextResponse.json({ success: true, explanation });
      }
    }
  } catch {
    // ignore network errors
  }

  return NextResponse.json(
    {
      success: false,
      error: {
        code: "DEFINITION_UNAVAILABLE",
        message: `Could not find a definition for “${rawWord}”. Try selecting a single root word.`,
      },
    },
    { status: 404 },
  );
}
