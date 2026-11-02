"use client";

import { useRef, useState } from "react";

import type { Question } from "@/lib/agent/runs";

import { recordAnswer, say, startRecording } from "./record";

export type Sent = { id: string; answer: string; spoken: boolean; photos: string[] };
type Taken = { file: string; preview: string };

// Phone photos are several MB; shrink them before sending (the server re-encodes them anyway).
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject()), "image/jpeg", 0.9));
  } catch {
    return file;
  }
}

// The agent's open questions as a form: a typed or spoken answer and up to 3 photos each. Used
// on the office page and on the technician's link; `photoUrl` and `voiceUrl` are where that page
// uploads photos and recordings. `handsFree` offers the spoken walk-through (the technician's
// page), for a phone in a pocket and Ray-Ban Meta glasses as the headset.
export function Questions({
  questions,
  photoUrl,
  voiceUrl,
  busy,
  handsFree = false,
  onSend,
}: {
  questions: Question[];
  photoUrl: string;
  voiceUrl: string;
  busy: boolean;
  handsFree?: boolean;
  onSend: (a: Sent[]) => void;
}) {
  const open = questions.filter((q) => q.answer === undefined);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Record<string, Taken[]>>({});
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Answers that are still exactly what Muse Voice Transcribe heard.
  const [spoken, setSpoken] = useState<Record<string, boolean>>({});
  const [recording, setRecording] = useState<{ id: string; stop: () => Promise<Blob> } | null>(null);
  const [transcribing, setTranscribing] = useState<string | null>(null);
  // The hands-free walk-through: which question it is on, and whether it was told to stop.
  const [walking, setWalking] = useState<{ id: string | null; listening: boolean } | null>(null);
  const stopWalk = useRef(false);

  async function transcribe(wav: Blob): Promise<string> {
    const res = await fetch(voiceUrl, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body.text as string;
  }

  function heard(questionId: string, text: string) {
    setAnswers((a) => ({ ...a, [questionId]: text }));
    setSpoken((s) => ({ ...s, [questionId]: true }));
  }

  function collect(typed: Record<string, string>, voiced: Record<string, boolean>): Sent[] {
    return open.map((q) => ({
      id: q.id,
      answer: typed[q.id] ?? "",
      spoken: !!voiced[q.id],
      photos: (photos[q.id] ?? []).map((t) => t.file),
    }));
  }

  async function speak(questionId: string) {
    setError(null);
    if (recording) {
      setRecording(null);
      setTranscribing(recording.id);
      try {
        const text = await transcribe(await recording.stop());
        if (text) heard(recording.id, text);
        else setError("Didn't catch that; try again or type it.");
      } catch (err) {
        setError(`Not transcribed: ${(err as Error).message}`);
      } finally {
        setTranscribing(null);
      }
      return;
    }
    try {
      setRecording({ id: questionId, stop: await startRecording() });
    } catch {
      setError("The microphone isn't available; type the answer instead.");
    }
  }

  // Reads each question aloud, listens for the answer (it stops by itself when the technician
  // does), reads back what it heard, and at the end sends when the technician says "send".
  async function walkThrough() {
    setError(null);
    stopWalk.current = false;
    const typed = { ...answers };
    const voiced = { ...spoken };
    const listen = async (id: string | null, options?: Parameters<typeof recordAnswer>[0]) => {
      setWalking({ id, listening: true });
      const wav = await recordAnswer(options);
      setWalking({ id, listening: false });
      return wav ? transcribe(wav) : "";
    };
    try {
      await say(open.length === 1 ? "One question from the office." : `${open.length} questions from the office.`);
      for (const q of open) {
        if (stopWalk.current) return;
        setWalking({ id: q.id, listening: false });
        let text = "";
        for (let tries = 0; tries < 2 && !text && !stopWalk.current; tries++) {
          await say(tries ? "Say that again?" : q.question);
          text = await listen(q.id);
        }
        if (stopWalk.current) return;
        if (text) {
          typed[q.id] = text;
          voiced[q.id] = true;
          heard(q.id, text);
          await say(`Got it: ${text}`);
        } else await say("Skipping that one.");
      }
      if (stopWalk.current) return;
      await say("Say send to send your answers, or anything else to check them on the screen first.");
      const reply = await listen(null, { quietMs: 1000, waitMs: 6000, maxMs: 8000 });
      if (/\b(send|yes|yeah|yep)\b/i.test(reply)) {
        await say("Sending.");
        onSend(collect(typed, voiced));
      } else await say("Not sent. Check them on the screen.");
    } catch (err) {
      setError(`Hands-free stopped: ${(err as Error).message}`);
    } finally {
      setWalking(null);
    }
  }

  function stopWalkThrough() {
    stopWalk.current = true;
    speechSynthesis.cancel();
  }

  async function add(questionId: string, files: FileList | null) {
    setError(null);
    for (const file of Array.from(files ?? []).slice(0, 3)) {
      setUploading((n) => n + 1);
      try {
        const blob = await shrink(file);
        const res = await fetch(photoUrl, {
          method: "POST",
          headers: { "Content-Type": blob.type || "image/jpeg" },
          body: blob,
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        const taken = { file: body.file as string, preview: URL.createObjectURL(blob) };
        setPhotos((p) => ({ ...p, [questionId]: [...(p[questionId] ?? []), taken].slice(0, 3) }));
      } catch (err) {
        setError(`Photo not added: ${(err as Error).message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  function remove(questionId: string, file: string) {
    setPhotos((p) => ({ ...p, [questionId]: (p[questionId] ?? []).filter((t) => t.file !== file) }));
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950"
      onSubmit={(e) => {
        e.preventDefault();
        onSend(collect(answers, spoken));
      }}
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
        Questions for the technician
      </h3>
      {handsFree && (
        <div className="flex flex-col gap-1 text-sm">
          <button
            type="button"
            onClick={walking ? stopWalkThrough : walkThrough}
            disabled={busy || recording !== null || transcribing !== null}
            className={`self-start rounded px-3 py-1.5 text-white disabled:opacity-50 ${walking ? "bg-red-600" : "bg-zinc-900 dark:bg-zinc-700"}`}
          >
            {walking ? "Stop hands-free" : "Hands-free: read the questions to me"}
          </button>
          <span className="text-xs text-zinc-500">
            {walking
              ? walking.listening
                ? "Listening… it stops when you do."
                : "Speaking…"
              : "Works through your phone or Ray-Ban Meta glasses. Answer each question out loud, then say “send”."}
          </span>
        </div>
      )}
      {open.map((q) => (
        <div
          key={q.id}
          className={`flex flex-col gap-1 rounded text-sm ${walking?.id === q.id ? "outline outline-2 outline-offset-4 outline-amber-500" : ""}`}
        >
          <label htmlFor={`answer-${q.id}`}>{q.question}</label>
          <div className="flex gap-2">
            <input
              id={`answer-${q.id}`}
              value={answers[q.id] ?? ""}
              onChange={(e) => {
                setAnswers({ ...answers, [q.id]: e.target.value });
                setSpoken({ ...spoken, [q.id]: false });
              }}
              placeholder={transcribing === q.id ? "Transcribing…" : "Answer, speak it, or add a photo"}
              className="min-w-0 flex-1 rounded border border-amber-300 bg-white px-2 py-1 dark:border-amber-700 dark:bg-zinc-900"
            />
            <button
              type="button"
              onClick={() => speak(q.id)}
              disabled={walking !== null || transcribing !== null || (recording !== null && recording.id !== q.id)}
              aria-pressed={recording?.id === q.id}
              className={`shrink-0 rounded border px-2 py-1 disabled:opacity-50 ${
                recording?.id === q.id
                  ? "border-red-500 bg-red-600 text-white"
                  : "border-amber-400 bg-white text-amber-800 dark:border-amber-700 dark:bg-zinc-900 dark:text-amber-300"
              }`}
            >
              {recording?.id === q.id ? "Stop" : "Speak"}
            </button>
            <label
              className={`shrink-0 cursor-pointer rounded border border-amber-400 bg-white px-2 py-1 text-amber-800 dark:border-amber-700 dark:bg-zinc-900 dark:text-amber-300 ${
                (photos[q.id]?.length ?? 0) >= 3 ? "pointer-events-none opacity-50" : ""
              }`}
            >
              Add photo
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  add(q.id, e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {spoken[q.id] && <span className="text-xs text-zinc-500">Transcribed by Muse Voice Transcribe; edit it if it misheard.</span>}
          {(photos[q.id]?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2">
              {photos[q.id].map((t) => (
                <span key={t.file} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the photo just taken */}
                  <img src={t.preview} alt="Photo for this answer" className="h-16 w-16 rounded object-cover" />
                  <button
                    type="button"
                    onClick={() => remove(q.id, t.file)}
                    aria-label="Remove photo"
                    className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-zinc-900 text-xs leading-5 text-white"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        disabled={busy || uploading > 0 || recording !== null || transcribing !== null || walking !== null}
        className="self-start rounded bg-amber-600 px-3 py-1 text-sm text-white disabled:opacity-50"
      >
        {uploading > 0 ? "Adding photo…" : "Send answers"}
      </button>
    </form>
  );
}
