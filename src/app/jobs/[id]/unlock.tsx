"use client";

import { useEffect, useState } from "react";

export const UNLOCKED = "fieldnotes:unlocked";

// The demo passcode prompt: shown only when the server asks for one and this browser
// hasn't entered it. Reading jobs and notes never needs it; running anything does.
export function Unlock() {
  const [locked, setLocked] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/unlock")
      .then((res) => res.json())
      .then((s: { required: boolean; unlocked: boolean }) => setLocked(s.required && !s.unlocked))
      .catch(() => {});
  }, []);

  if (!locked) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: code }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setLocked(false);
      // Parts of the page that asked before the passcode (the technician's QR) ask again.
      window.dispatchEvent(new Event(UNLOCKED));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
      <span className="text-zinc-600 dark:text-zinc-400">Running the agent needs the demo passcode.</span>
      <input
        type="password"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Passcode"
        autoComplete="off"
        className="w-36 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
      />
      <button disabled={busy || !code} className="rounded bg-zinc-900 px-3 py-1 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
        Unlock
      </button>
      {error && <span className="text-red-600">{error}</span>}
    </form>
  );
}
