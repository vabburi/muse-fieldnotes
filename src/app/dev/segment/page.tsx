"use client";

import { useState } from "react";

import type { Segmentation } from "@/lib/sam";

// Dev page for the evidence view: pick a photo, name a part, see SAM 3.1's mask.
export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("air handler");
  const [result, setResult] = useState<Segmentation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pick(next: File | null) {
    setFile(next);
    setResult(null);
    setError(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(next ? URL.createObjectURL(next) : null);
  }

  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("image", file);
    form.set("prompt", prompt);
    try {
      const res = await fetch("/api/segment", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setResult(body);
    } catch (err) {
      setResult(null);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10">
      <header>
        <h1 className="text-2xl font-semibold">muse-fieldnotes</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Evidence view: name a part, SAM 3.1 highlights it.</p>
      </header>

      <form onSubmit={run} className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="short noun phrase, e.g. red dehumidifier"
          className="min-w-56 flex-1 rounded border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
        />
        <button
          type="submit"
          disabled={!file || !prompt.trim() || busy}
          className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {busy ? "Segmenting…" : "Highlight"}
        </button>
      </form>

      {error && <p className="text-red-600">{error}</p>}

      {result && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {result.objects.length} match{result.objects.length === 1 ? "" : "es"} for “{result.prompt}” in {result.ms} ms
          {result.objects.map((o) =>
            o.confidence === undefined ? "" : ` · #${o.id} ${(o.confidence * 100).toFixed(0)}%`,
          )}
        </p>
      )}

      {preview && (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
          <img src={preview} alt="Selected job photo" className="block w-full rounded" />
          {result && result.width > 0 && (
            <svg
              viewBox={`0 0 ${result.width} ${result.height}`}
              className="pointer-events-none absolute inset-0 h-full w-full"
              preserveAspectRatio="none"
            >
              {result.objects.map((o) => (
                <path
                  key={o.id}
                  d={o.path}
                  transform={o.transform}
                  fill="rgb(250 204 21 / 0.45)"
                  stroke="rgb(250 204 21)"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          )}
        </div>
      )}
    </main>
  );
}
