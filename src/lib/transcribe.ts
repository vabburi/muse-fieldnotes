import "server-only";

import { MetaApiError } from "./meta";

// Muse Voice Transcribe, file upload. The endpoint only takes mono 16-bit PCM WAV at 16 or
// 24 kHz (convert first: ffmpeg -i in.m4a -ac 1 -ar 16000 out.wav), up to 10 minutes.
const BASE_URL = process.env.MODEL_API_BASE_URL ?? "https://api.meta.ai/v1";
export const TRANSCRIBE_MODEL = "muse-voice-transcribe-1.0";

export interface Transcript {
  text: string;
  audioMs: number;
  ms: number;
}

export async function transcribe(wav: Uint8Array<ArrayBuffer>): Promise<Transcript> {
  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey) throw new Error("MODEL_API_KEY is not set");

  const form = new FormData();
  // Multipart parts "request" (JSON) and "audio"; audioEncoding must be upper case.
  form.append(
    "request",
    new Blob([JSON.stringify({ model: TRANSCRIBE_MODEL, audioEncoding: "WAV" })], { type: "application/json" }),
  );
  form.append("audio", new Blob([wav], { type: "audio/wav" }), "audio.wav");

  const started = Date.now();
  const res = await fetch(`${BASE_URL}/asr/transcribe`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const body = await res.text();
  if (!res.ok) throw new MetaApiError(res.status, body);
  const data = JSON.parse(body) as { transcript?: string; audioDurationMs?: number; error?: { message: string } };
  if (data.error || data.transcript === undefined) throw new MetaApiError(res.status, body);
  return { text: data.transcript, audioMs: data.audioDurationMs ?? 0, ms: Date.now() - started };
}
