import "server-only";

import { NOTE_RULES } from "../closeout";
import { photoDataUrl } from "../fixtures";
import { describeSource } from "../grounding";
import { responsesCreate, type ResponseInputPart, type ResponseItem } from "../meta";
import type { Job } from "../model";
import { shopChecklist } from "./checklist";
import { loadRun, saveRun, type AgentRun } from "./runs";
import { definitions, MAX_REFUSALS, recordAnswers, runTool, type Answer, type Context } from "./tools";

// The close-out agent: each turn the model plans and picks one tool, the tool runs (with its
// checks), and the result goes back to the model. The run stops when a tool says so (questions
// for the technician, the office's sign-off, escalation), or at the turn limit.

export const MAX_TURNS = 14;
// Turns allowed after the technician answers, and after the office sends the note back: enough
// for a re-read, the checklist and the note each to be refused twice (and asking again after a
// send-back) without stopping short of a note.
const TURNS_AFTER_ANSWERS = 12;
const TURNS_AFTER_SEND_BACK = 10;
// Stop a stretch of turns before the platform's time limit (route maxDuration is 300 s).
const MAX_DRIVE_MS = 240_000;

const INSTRUCTIONS = `You are the close-out agent for a residential HVAC shop. From a job's sources (dispatch
record, the technician's photos, voice notes and messages, the price book) you write the close-out
note the office, the comfort advisor and the next technician read.

Work in this order, calling exactly one tool per turn and never answering in plain text:
1. If any photo shows an equipment rating plate or a part's label, read_nameplates with all of them.
2. set_checklist: one entry per item of the shop's checklist, marking each found, ask or not_applicable.
   Mark ask when the sources leave the item missing, unclear or contradictory (for example: the house
   has two systems and the notes don't say which one; a part's size or a refrigerant amount isn't
   recorded; the voice note is garbled).
3. If any entry is ask, ask_tech once with those questions, then wait for the answers.
4. When answers come back, set_checklist again with what they settled, then submit_note.
5. If the office rejects the note and asks to confirm something with the technician, mark it ask
   (set_checklist) and ask_tech; otherwise address the office's notes and submit_note again.
If a tool refuses your call, fix exactly what its problems say and call it again. After
${MAX_REFUSALS} refused notes the office takes over, so get it right.

Before each tool call, say in one short sentence what you are doing and why.

How to write the note (submit_note):
${NOTE_RULES}
- Do not write lines for questions the technician didn't answer: they go to the office as open
  questions automatically.`;

async function firstMessage(job: Job): Promise<ResponseItem> {
  const shop = shopChecklist(job)
    .map((i) => `- ${i.id}: ${i.text}`)
    .join("\n");
  const content: ResponseInputPart[] = [
    {
      type: "input_text",
      text: `Job ${job.id}: ${job.title}\nCall type: ${job.callType ?? "maintenance"}\n\nThe shop's close-out checklist:\n${shop}\n\nSources:`,
    },
  ];
  for (const source of job.sources) {
    content.push({ type: "input_text", text: describeSource(source) });
    if (source.kind === "photo") content.push({ type: "input_image", image_url: `${PHOTO_REF}${source.photo.file}` });
  }
  return { role: "user", content };
}

// The saved conversation names photos instead of carrying them (a run stays ~100 KB instead
// of ~2 MB in storage); they are put back in just before each call.
const PHOTO_REF = "fixture-photo:";

async function withPhotos(job: Job, messages: ResponseItem[]): Promise<ResponseItem[]> {
  const urls = new Map<string, Promise<string>>();
  const expand = (file: string) => {
    if (!urls.has(file)) urls.set(file, photoDataUrl(job.id, file));
    return urls.get(file)!;
  };
  return Promise.all(
    messages.map(async (m) => {
      if (!("role" in m) || m.role !== "user") return m;
      const user = m as Extract<ResponseItem, { role: "user" }>;
      if (typeof user.content === "string") return m;
      const content = await Promise.all(
        user.content.map(async (part) =>
          part.type === "input_image" && part.image_url.startsWith(PHOTO_REF)
            ? { ...part, image_url: await expand(part.image_url.slice(PHOTO_REF.length)) }
            : part,
        ),
      );
      return { ...user, content };
    }),
  );
}

function said(output: ResponseItem[]): string | undefined {
  const text = output
    .flatMap((o) => ("type" in o && o.type === "message" ? o.content.map((c) => c.text ?? "") : []))
    .join(" ")
    .trim();
  return text || undefined;
}

// Runs turns until the run stops. Saves after every turn so the page can follow along.
export async function drive(job: Job, run: AgentRun): Promise<AgentRun> {
  const ctx: Context = { job, run };
  const tools = definitions(job);
  const driveStarted = Date.now();
  run.status = "running";
  run.note = undefined;
  await saveRun(run);

  while (run.status === "running") {
    if (run.turn >= run.maxTurns) {
      run.status = "paused";
      run.note = `Stopped at the turn limit (${run.maxTurns}).`;
      break;
    }
    if (Date.now() - driveStarted > MAX_DRIVE_MS) {
      run.status = "paused";
      run.note = "Stopped before the server's time limit.";
      break;
    }
    run.turn++;
    if (run.turn === run.maxTurns) {
      run.messages.push({ role: "user", content: "This is your last turn. Call submit_note now with what you have." });
    }

    let response;
    try {
      const input = await withPhotos(job, run.messages);
      response = await responsesCreate({ instructions: INSTRUCTIONS, input, tools, reasoningEffort: "low" });
    } catch (error) {
      run.status = "paused";
      run.note = `Model API failed: ${(error as Error).message.slice(0, 300)}`;
      break;
    }
    run.messages.push(...response.output);
    run.tokens.input += response.usage?.input_tokens ?? 0;
    run.tokens.output += response.usage?.output_tokens ?? 0;
    run.ms.model += response.ms;

    const call = response.output.find((o) => "type" in o && o.type === "function_call") as
      | Extract<ResponseItem, { type: "function_call" }>
      | undefined;
    if (!call) {
      run.messages.push({ role: "user", content: "Plain text is not accepted. Call exactly one tool." });
      run.steps.push({ turn: run.turn, at: new Date().toISOString(), said: said(response.output), ms: { model: response.ms }, refused: true, result: { error: "no tool call" } });
      await saveRun(run);
      continue;
    }

    const started = Date.now();
    let args: Record<string, unknown> = {};
    let outcome;
    try {
      args = JSON.parse(call.arguments || "{}");
      outcome = await runTool(ctx, call.name, args);
    } catch (error) {
      outcome = { result: { error: `Tool failed: ${(error as Error).message.slice(0, 300)}` }, refused: true };
    }
    const toolMs = Date.now() - started;
    run.ms.tools += toolMs;
    run.messages.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(outcome.result) });
    run.steps.push({
      turn: run.turn,
      at: new Date().toISOString(),
      said: said(response.output),
      tool: call.name,
      args,
      result: outcome.result,
      refused: outcome.refused,
      ms: { model: response.ms, tool: toolMs },
    });
    if ("status" in outcome && outcome.status) run.status = outcome.status;
    await saveRun(run);
    if (run.status !== "running") return run;
  }
  // Stopped by the turn or time limit, or a Model API failure: not saved yet.
  await saveRun(run);
  return run;
}

// Anything that escapes the loop marks the run failed, so the page never waits on a dead run.
export async function failRun(runId: string, error: unknown) {
  const run = await loadRun(runId);
  if (!run) return;
  run.status = "failed";
  run.note = (error as Error).message.slice(0, 300);
  await saveRun(run);
}

export async function start(job: Job, run: AgentRun): Promise<AgentRun> {
  run.messages = [await firstMessage(job)];
  return drive(job, run);
}

function event(run: AgentRun, text: string) {
  run.steps.push({ turn: run.turn, at: new Date().toISOString(), event: text, ms: { model: 0 } });
}

// The technician answered (or skipped): their answers become sources and the agent continues.
export async function answer(job: Job, run: AgentRun, answers: Answer[]) {
  const { summary, photos } = recordAnswers({ job, run }, answers);
  event(run, `Technician answered:\n${summary}`);
  // Refusals count per phase: the checklist gets a fresh budget after the answers.
  if (run.checklist) run.checklist.refusals = 0;
  const content: ResponseInputPart[] = [
    {
      type: "input_text",
      text: `The technician answered (each answer is now a source you can cite):\n${summary}\n${
        photos.length ? "If a new photo shows a rating plate or a part's label, read_nameplates with it first. " : ""
      }Update the checklist with set_checklist, then submit_note.`,
    },
  ];
  for (const source of photos) {
    if (source.kind !== "photo") continue;
    content.push({ type: "input_text", text: describeSource(source) });
    content.push({ type: "input_image", image_url: `${PHOTO_REF}${source.photo.file}` });
  }
  run.messages.push({ role: "user", content });
  run.maxTurns = run.turn + TURNS_AFTER_ANSWERS;
  return drive(job, run);
}

// The office signs off: approve ends the run; reject sends the notes back to the agent.
export async function review(job: Job, run: AgentRun, decision: "approved" | "rejected", notes: string) {
  run.review = { decision, notes, at: new Date().toISOString() };
  event(run, `Office ${decision} the note${notes ? `: ${notes}` : ""}`);
  if (decision === "approved") {
    run.status = "done";
    run.note = "Approved by the office.";
    await saveRun(run);
    return run;
  }
  run.noteRefusals = 0;
  if (run.checklist) run.checklist.refusals = 0;
  run.messages.push({
    role: "user",
    content:
      `The office rejected the note: ${notes}\nIf the office wants something confirmed with the technician, mark it ask ` +
      "(set_checklist) and ask_tech; otherwise address the notes and submit a revised note (submit_note).",
  });
  run.maxTurns = run.turn + TURNS_AFTER_SEND_BACK;
  return drive(job, run);
}
