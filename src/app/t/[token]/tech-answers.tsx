"use client";

import { useEffect, useState } from "react";

import type { Question } from "@/lib/agent/runs";

import { Questions, type Sent } from "../../jobs/[id]/questions";

interface Link {
  job: { id: string; title: string };
  status: string;
  questions: Question[];
}

export function TechAnswers({ token }: { token: string }) {
  const [link, setLink] = useState<Link | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "sending" | "sent" | "invalid">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/t/${token}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((l: Link) => {
        setLink(l);
        setState("ready");
      })
      .catch(() => setState("invalid"));
  }, [token]);

  async function send(answers: Sent[]) {
    setState("sending");
    setError(null);
    try {
      const res = await fetch(`/api/t/${token}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setState("sent");
    } catch (err) {
      setError((err as Error).message);
      setState("ready");
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-6">
      {state === "loading" && <p className="text-sm text-zinc-500">Loading…</p>}
      {state === "invalid" && <p>This link isn&apos;t valid. Ask the office for a new one.</p>}
      {link && (
        <header className="flex flex-col gap-1">
          <span className="font-mono text-xs text-zinc-500">{link.job.id}</span>
          <h1 className="text-xl font-semibold leading-tight">{link.job.title}</h1>
        </header>
      )}
      {state === "sent" && (
        <p className="rounded-lg bg-emerald-50 p-3 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          Sent. The office has your answers and the close-out note is being finished.
        </p>
      )}
      {link && state !== "sent" && link.questions.length === 0 && (
        <p className="text-zinc-600 dark:text-zinc-400">Nothing is waiting on you for this job.</p>
      )}
      {link && (state === "ready" || state === "sending") && link.questions.length > 0 && (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            The office needs a few details to finish the close-out note. Type or speak an answer, or take a photo
            of the label; leave it empty if you don&apos;t know.
          </p>
          <Questions
            questions={link.questions}
            photoUrl={`/api/t/${token}/photos`}
            voiceUrl={`/api/t/${token}/voice`}
            busy={state === "sending"}
            handsFree
            onSend={send}
          />
        </>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </main>
  );
}
