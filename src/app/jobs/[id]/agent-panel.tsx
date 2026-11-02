"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { shopChecklist } from "@/lib/agent/checklist";
import type { AgentRun, Step } from "@/lib/agent/runs";
import type { Job } from "@/lib/model";

import { Questions } from "./questions";
import { UNLOCKED } from "./unlock";

type Run = Omit<AgentRun, "messages">;

const STATUS: Record<AgentRun["status"], { text: string; className: string }> = {
  running: { text: "Working", className: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" },
  needs_input: { text: "Waiting for the technician", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  awaiting_signoff: { text: "Waiting for office sign-off", className: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300" },
  escalated: { text: "Escalated to the office", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  done: { text: "Approved", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  paused: { text: "Paused", className: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  failed: { text: "Failed", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
};

const PUBLISHED = new Set<AgentRun["status"]>(["awaiting_signoff", "escalated", "done"]);

// A run still "running" with no progress for 3 minutes was cut off (server restart, time limit).
function stale(run: Run): boolean {
  return Date.now() - new Date(run.updatedAt ?? run.createdAt).getTime() > 180_000;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// The close-out agent: start a run, follow its turns live, answer its questions as the
// technician, and sign off as the office. `onNote` fires when the run submits a note.
export function AgentPanel({ job, onNote, onStart }: { job: Job; onNote: () => void; onStart: () => void }) {
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Starting over discards a run that is waiting on someone, so that takes a second click.
  const [confirming, setConfirming] = useState(false);
  const noteSeen = useRef<string | null>(null);

  const apply = useCallback(
    (next: Run) => {
      setRun(next);
      // The note is published only when it passes or is escalated; reload it once per submission.
      const submitted = next.checks.filter((c) => c.check === "note").length;
      const key = PUBLISHED.has(next.status) ? `${next.id}:${submitted}` : null;
      if (key && key !== noteSeen.current) {
        noteSeen.current = key;
        onNote();
      }
    },
    [onNote],
  );

  useEffect(() => {
    fetch(`/api/jobs/${job.id}/agent`)
      .then((res) => (res.ok ? res.json() : null))
      .then((r: Run | null) => {
        if (!r) return;
        noteSeen.current = PUBLISHED.has(r.status) ? `${r.id}:${r.checks.filter((c) => c.check === "note").length}` : null;
        setRun(r);
      });
  }, [job.id]);

  // Poll while the agent works, and (more slowly) while the technician may be answering from
  // their phone.
  useEffect(() => {
    if (run?.status !== "running" && run?.status !== "needs_input") return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/runs/${run.id}`);
      if (res.ok) apply(await res.json());
    }, run.status === "running" ? 1500 : 3000);
    return () => clearInterval(timer);
  }, [run?.id, run?.status, apply]);

  async function post(url: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const next = await res.json();
      if (!res.ok) throw new Error(next.error ?? `HTTP ${res.status}`);
      apply(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const waiting = run?.status === "needs_input" || run?.status === "awaiting_signoff" || run?.status === "escalated";

  function start() {
    if (waiting && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    noteSeen.current = null;
    onStart();
    return post(`/api/jobs/${job.id}/agent`);
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-3">
        {waiting ? (
          // Mid-run the next step is the technician's or the office's, so starting over is secondary.
          <span className="flex items-center gap-2 text-sm">
            <button
              onClick={start}
              disabled={busy}
              className={`rounded px-3 py-1 disabled:opacity-50 ${confirming ? "bg-red-600 text-white" : "border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"}`}
            >
              {confirming ? "Discard this run and start over" : "Start over"}
            </button>
            {confirming && (
              <button onClick={() => setConfirming(false)} className="text-zinc-500 underline">
                Keep it
              </button>
            )}
          </span>
        ) : (
          <button
            onClick={start}
            disabled={busy || (run?.status === "running" && !stale(run))}
            className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {run ? "Run the agent again" : "Close out with the agent"}
          </button>
        )}
        {run && (
          <>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[run.status].className}`}>
              {STATUS[run.status].text}
              {run.status === "running" && "…"}
            </span>
            <span className="text-xs text-zinc-500">
              {plural(run.turn, "turn")} ·{((run.ms.model + run.ms.tools) / 1000).toFixed(0)} s ·{" "}
              {Math.round((run.tokens.input + run.tokens.output) / 1000)}k tokens
            </span>
          </>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {run?.note && <p className="text-sm text-zinc-500">{run.note}</p>}

      {run && <Checklist job={job} run={run} />}
      {run?.status === "needs_input" && (
        <>
          <TechLink runId={run.id} />
          <Questions
            questions={run.questions}
            photoUrl={`/api/runs/${run.id}/photos`}
            busy={busy}
            onSend={(answers) => post(`/api/runs/${run.id}/answer`, { answers })}
          />
        </>
      )}
      {run && (run.status === "awaiting_signoff" || run.status === "escalated") && (
        <SignOff run={run} busy={busy} onReview={(decision, notes) => post(`/api/runs/${run.id}/review`, { decision, notes })} />
      )}
      {run && run.steps.length > 0 && <Trace run={run} />}
    </section>
  );
}

function Checklist({ job, run }: { job: Job; run: Run }) {
  if (!run.checklist) return null;
  const marks = { found: "✓", ask: "?", not_applicable: "–" } as const;
  return (
    <div className="text-sm">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Shop checklist {run.checklist.accepted ? "· accepted" : "· refused"}
        {run.checklist.refusals > 0 && ` after ${run.checklist.refusals} refusal${run.checklist.refusals > 1 ? "s" : ""}`}
      </h3>
      <ul className="flex flex-col gap-0.5">
        {shopChecklist(job).map((item) => {
          const entry = run.checklist!.entries.find((e) => e.item === item.id);
          const asked = run.questions.find((q) => q.item === item.id && q.answer !== undefined);
          return (
            <li key={item.id} className="flex gap-2" title={item.text}>
              <span className="w-4 shrink-0 text-center font-mono">{entry ? marks[entry.status] : "·"}</span>
              <span className="w-28 shrink-0 text-zinc-500">{item.id}</span>
              <span className={entry?.status === "ask" && !asked?.answerSource ? "text-amber-700 dark:text-amber-400" : ""}>
                {entry?.note ?? "—"}
                {asked && (
                  <span className="text-zinc-500">
                    {" → "}
                    {asked.answerSource
                      ? "answered"
                      : entry?.status === "ask"
                        ? "no answer, open for the office"
                        : "settled from the other sources (question went unanswered)"}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// The technician's link for this run as a QR code, so they can answer from their phone. Shown
// only to the office (the link needs the passcode to get).
function TechLink({ runId }: { runId: string }) {
  const [link, setLink] = useState<{ url: string; qr: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const load = () =>
      fetch(`/api/runs/${runId}/tech-link`)
        .then((res) => (res.ok ? res.json() : null))
        .then(setLink)
        .catch(() => {});
    load();
    // Locked before the passcode is entered; try again once it is.
    window.addEventListener(UNLOCKED, load);
    return () => window.removeEventListener(UNLOCKED, load);
  }, [runId]);

  if (!link) return null;
  return (
    <div className="flex items-center gap-4 rounded-lg border border-amber-300 p-3 text-sm dark:border-amber-700">
      <div
        className="h-28 w-28 shrink-0 rounded bg-white p-1 [&>svg]:h-full [&>svg]:w-full"
        // The SVG is made on our server from our own URL.
        dangerouslySetInnerHTML={{ __html: link.qr }}
      />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-medium">Send to the technician</span>
        <span className="text-zinc-500">They scan this to answer from their phone, with photos. This page updates when they send.</span>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(link.url).then(() => setCopied(true))}
          className="self-start text-amber-700 underline underline-offset-2 dark:text-amber-400"
        >
          {copied ? "Link copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
}

function SignOff({ run, busy, onReview }: { run: Run; busy: boolean; onReview: (d: "approved" | "rejected", notes: string) => void }) {
  const [notes, setNotes] = useState("");
  const lastProblems = run.checks.filter((c) => !c.passed).at(-1)?.problems ?? [];
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-violet-300 bg-violet-50 p-3 text-sm dark:border-violet-800 dark:bg-violet-950">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">Office sign-off</h3>
      {run.status === "escalated" ? (
        <div>
          The agent&apos;s note was refused {run.noteRefusals} times. Last problems:
          <ul className="list-disc pl-5">
            {lastProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p>Every line passed the checks. Approve it, or send it back with what to fix.</p>
      )}
      {run.review?.decision === "rejected" && (
        // This note is the agent's revision, so a send-back doesn't look ignored.
        <p className="rounded bg-white/60 p-2 text-violet-900 dark:bg-zinc-900/60 dark:text-violet-200">
          Revised after you sent it back at {new Date(run.review.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}:{" "}
          <q>{run.review.notes}</q>
        </p>
      )}
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Notes for the agent (needed to send it back)"
        className="rounded border border-violet-300 bg-white p-2 dark:border-violet-800 dark:bg-zinc-900"
      />
      <div className="flex gap-2">
        <button
          onClick={() => onReview("approved", notes)}
          disabled={busy}
          className="rounded bg-emerald-600 px-3 py-1 text-white disabled:opacity-50"
        >
          Approve
        </button>
        <button
          onClick={() => onReview("rejected", notes)}
          disabled={busy || !notes.trim()}
          className="rounded border border-zinc-400 px-3 py-1 disabled:opacity-50"
        >
          Send back
        </button>
      </div>
    </div>
  );
}

const TOOL_LABELS: Record<string, string> = {
  read_nameplates: "Read nameplates",
  set_checklist: "Set checklist",
  ask_tech: "Ask the technician",
  submit_note: "Submit note",
};

// Plan, act, observe: one row per turn, refusals in red, with the checks' problems.
function Trace({ run }: { run: Run }) {
  return (
    <details open={run.status === "running" || run.status === "needs_input"} className="text-sm">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Agent trace ({plural(run.turn, "turn")}, {run.checks.filter((c) => !c.passed).length} refused by the checks)
      </summary>
      <ol className="mt-2 flex flex-col gap-2">
        {run.steps.map((step, i) => (
          <TraceStep key={i} step={step} />
        ))}
        {run.status === "running" && <li className="text-xs text-zinc-500">Turn {run.turn + 1}: thinking…</li>}
      </ol>
    </details>
  );
}

function TraceStep({ step }: { step: Step }) {
  if (step.event) {
    return <li className="whitespace-pre-line border-l-2 border-amber-400 pl-2 text-xs text-zinc-600 dark:text-zinc-400">{step.event}</li>;
  }
  const result = (step.result ?? {}) as { problems?: string[]; error?: string; next?: string; asked?: string[] };
  return (
    <li className={`border-l-2 pl-2 ${step.refused ? "border-red-500" : "border-emerald-500"}`}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-xs text-zinc-500">#{step.turn}</span>
        <span className="font-medium">{step.tool ? (TOOL_LABELS[step.tool] ?? step.tool) : "No tool call"}</span>
        <span className={`text-xs ${step.refused ? "text-red-600" : "text-emerald-700 dark:text-emerald-400"}`}>
          {step.refused ? (result.error ?? "refused") : "ok"}
        </span>
        <span className="text-xs text-zinc-400">
          {(step.ms.model / 1000).toFixed(1)} s model{step.ms.tool ? ` · ${(step.ms.tool / 1000).toFixed(1)} s tool` : ""}
        </span>
      </div>
      {step.said && <p className="text-zinc-600 dark:text-zinc-400">{step.said}</p>}
      {result.problems && (
        <ul className="list-disc pl-5 text-xs text-red-700 dark:text-red-400">
          {result.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {result.next && <p className="text-xs text-zinc-500">{result.next}</p>}
    </li>
  );
}
