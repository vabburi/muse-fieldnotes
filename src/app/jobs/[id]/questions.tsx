"use client";

import { useState } from "react";

import type { Question } from "@/lib/agent/runs";

export type Sent = { id: string; answer: string; photos: string[] };
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

// The agent's open questions as a form: a typed answer and up to 3 photos each. Used on the
// office page and on the technician's link; `photoUrl` is where that page uploads photos.
export function Questions({
  questions,
  photoUrl,
  busy,
  onSend,
}: {
  questions: Question[];
  photoUrl: string;
  busy: boolean;
  onSend: (a: Sent[]) => void;
}) {
  const open = questions.filter((q) => q.answer === undefined);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Record<string, Taken[]>>({});
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);

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
        onSend(open.map((q) => ({ id: q.id, answer: answers[q.id] ?? "", photos: (photos[q.id] ?? []).map((t) => t.file) })));
      }}
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
        Questions for the technician
      </h3>
      {open.map((q) => (
        <div key={q.id} className="flex flex-col gap-1 text-sm">
          <label htmlFor={`answer-${q.id}`}>{q.question}</label>
          <div className="flex gap-2">
            <input
              id={`answer-${q.id}`}
              value={answers[q.id] ?? ""}
              onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
              placeholder="Answer, or add a photo"
              className="min-w-0 flex-1 rounded border border-amber-300 bg-white px-2 py-1 dark:border-amber-700 dark:bg-zinc-900"
            />
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
        disabled={busy || uploading > 0}
        className="self-start rounded bg-amber-600 px-3 py-1 text-sm text-white disabled:opacity-50"
      >
        {uploading > 0 ? "Adding photo…" : "Send answers"}
      </button>
    </form>
  );
}
