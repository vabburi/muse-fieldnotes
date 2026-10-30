// Transcribe a voice recording with Muse Voice Transcribe and print the transcript.
// Converts any input to 16 kHz mono WAV with ffmpeg first, since the API takes only that.
// Usage: node --env-file=.env scripts/transcribe.mjs path/to/voice.m4a
import { execFileSync } from "node:child_process";

const input = process.argv[2];
const apiKey = process.env.MODEL_API_KEY;
if (!input || !apiKey) {
  console.error("Usage: node --env-file=.env scripts/transcribe.mjs voice.m4a (needs MODEL_API_KEY)");
  process.exit(1);
}

const wav = execFileSync("ffmpeg", ["-v", "error", "-i", input, "-ac", "1", "-ar", "16000", "-f", "wav", "-"], {
  maxBuffer: 64 * 1024 * 1024,
});
const form = new FormData();
form.append(
  "request",
  new Blob([JSON.stringify({ model: "muse-voice-transcribe-1.0", audioEncoding: "WAV" })], { type: "application/json" }),
);
form.append("audio", new Blob([wav], { type: "audio/wav" }), "audio.wav");

const started = Date.now();
const res = await fetch(`${process.env.MODEL_API_BASE_URL ?? "https://api.meta.ai/v1"}/asr/transcribe`, {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}` },
  body: form,
});
const body = await res.json();
if (!res.ok || body.error) {
  console.error(res.status, JSON.stringify(body));
  process.exit(1);
}
console.log(`${(body.audioDurationMs / 1000).toFixed(1)} s of audio, transcribed in ${Date.now() - started} ms:\n`);
console.log(body.transcript);
