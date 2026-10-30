import "server-only";

import { randomUUID } from "node:crypto";

import { cacheGet, cacheSet } from "../cache";
import type { CloseOutRun } from "../closeout";
import type { ResponseItem } from "../meta";
import type { Claim, Source } from "../model";

// A close-out agent run: the conversation with the model, what it did each turn, and the
// state its tools keep (checklist, questions, the submitted note). Saved after every turn.

export type RunStatus =
  | "running"
  | "needs_input" // waiting for the technician to answer questions
  | "awaiting_signoff" // the note passed every check; waiting for the office
  | "escalated" // refused too often; the office takes over
  | "done" // the office approved the note
  | "paused" // out of turns, or the Model API kept failing
  | "failed";

export interface ChecklistEntry {
  item: string; // shop checklist item id
  status: "found" | "ask" | "not_applicable";
  note: string; // what the sources record, the question, or why it doesn't apply
  sources: string[];
}

export interface CheckResult {
  check: "checklist" | "note";
  passed: boolean;
  problems: string[];
  ms: number;
  by: string; // which checks ran, e.g. "code" or "code + Muse Spark Open"
}

export interface Question {
  id: string; // Q1, Q2, …
  item: string;
  question: string;
  answer?: string;
  answerSource?: string; // the source the answer became (its text, or else its first photo)
  photoSources?: string[]; // photos the technician took for it
}

export interface Step {
  turn: number;
  at: string;
  said?: string; // what the model wrote before acting (its plan, when it gives one)
  tool?: string;
  args?: unknown;
  result?: unknown;
  // The tool refused the call (a check failed); the result says why.
  refused?: boolean;
  ms: { model: number; tool?: number };
  // A message from outside the loop: an answer, the office, a nudge.
  event?: string;
}

export interface AgentRun {
  id: string;
  jobId: string;
  status: RunStatus;
  note?: string; // why the run stopped, for the UI
  createdAt: string;
  updatedAt?: string;
  turn: number;
  maxTurns: number;
  messages: ResponseItem[];
  steps: Step[];
  // Sources added during the run: nameplate readings and the technician's answers.
  derived: Source[];
  checklist?: { entries: ChecklistEntry[]; accepted: boolean; refusals: number };
  checks: CheckResult[];
  questions: Question[];
  noteRefusals: number;
  claims?: Claim[];
  review?: { decision: "approved" | "rejected"; notes: string; at: string };
  tokens: { input: number; output: number };
  ms: { model: number; tools: number };
}

export function newRun(jobId: string, maxTurns: number): AgentRun {
  return {
    id: randomUUID().slice(0, 8),
    jobId,
    status: "running",
    createdAt: new Date().toISOString(),
    turn: 0,
    maxTurns,
    messages: [],
    steps: [],
    derived: [],
    checks: [],
    questions: [],
    noteRefusals: 0,
    tokens: { input: 0, output: 0 },
    ms: { model: 0, tools: 0 },
  };
}

export async function loadRun(id: string): Promise<AgentRun | undefined> {
  if (!/^[0-9a-f]{8}$/.test(id)) return undefined;
  return cacheGet<AgentRun>("runs", id);
}

export async function saveRun(run: AgentRun): Promise<void> {
  run.updatedAt = new Date().toISOString();
  await cacheSet("runs", run.id, run);
  await cacheSet("latest-run", run.jobId, { id: run.id });
}

export async function latestRunId(jobId: string): Promise<string | undefined> {
  return (await cacheGet<{ id: string }>("latest-run", jobId))?.id;
}

// The note in the shape the job page already renders, once the agent has submitted one.
export function asCloseOut(run: AgentRun, model: string): CloseOutRun | undefined {
  if (!run.claims) return undefined;
  const followUps = run.questions
    .filter((q) => !q.answerSource) // asked and not answered
    .map((q) => ({ question: q.question }));
  return {
    closeOut: { jobId: run.jobId, model, createdAt: run.createdAt, claims: run.claims, followUps },
    derived: run.derived,
    timings: { draft: run.ms.model },
    agentRunId: run.id,
  };
}

// What the page sees: everything but the raw conversation (which carries the photos).
export function publicRun(run: AgentRun): Omit<AgentRun, "messages"> {
  const { messages, ...rest } = run;
  void messages;
  return rest;
}
