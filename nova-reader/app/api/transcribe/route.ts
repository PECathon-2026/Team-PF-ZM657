// POST /api/transcribe
// Server-side audio transcription endpoint using @google/genai (gemini-3.5-transcribe).
// Enables getUserMedia + MediaRecorder microphone voice input across ALL browsers
// (Firefox, Safari, Brave, Chrome) and inside cross-origin preview iframes where
// browser webkitSpeechRecognition is unavailable or restricted.

import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

type TranscribeBody = {
  audioBase64?: unknown;
  mimeType?: unknown;
};

const MAX_BASE64_LENGTH = 8 * 1024 * 1024; // ~6 MB audio clip max

export async function POST(request: Request): Promise<Response> {
  let body: TranscribeBody;
  try {
    body = (await request.json()) as TranscribeBody;
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON request body." } },
      { status: 400 },
    );
  }

  const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64.trim() : "";
  const rawMime = typeof body.mimeType === "string" ? body.mimeType.trim() : "audio/webm";
  // Strip codec parameters like "audio/webm;codecs=opus" -> "audio/webm"
  const mimeType = rawMime.split(";")[0]?.trim() || "audio/webm";

  if (!audioBase64) {
    return NextResponse.json(
      { success: false, error: { code: "EMPTY_AUDIO", message: "No recorded audio was received." } },
      { status: 400 },
    );
  }
  if (audioBase64.length > MAX_BASE64_LENGTH) {
    return NextResponse.json(
      { success: false, error: { code: "AUDIO_TOO_LARGE", message: "Voice recording is too long. Keep commands short." } },
      { status: 413 },
    );
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "TRANSCRIPTION_KEY_MISSING",
          message: "Server voice transcription requires GEMINI_API_KEY, or use Chrome/Edge built-in speech recognition.",
        },
      },
      { status: 503 },
    );
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    const response = await ai.models.generateContent({
      model: "gemini-3.5-transcribe",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: audioBase64,
            },
          },
          {
            text: "Transcribe the spoken voice command or search keyword accurately. Return only the spoken words as plain text with no extra commentary. If there is only silence or background noise, return an empty string.",
          },
        ],
      },
    });

    const transcript = (response.text ?? "").trim();
    return NextResponse.json({ success: true, transcript });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "TRANSCRIBE_FAILED",
          message: "Could not transcribe voice audio right now. Please try speaking again.",
        },
      },
      { status: 502 },
    );
  }
}
