import "server-only";

import { cacheSet } from "../cache";
import { MODEL, photoRegion, readNameplate } from "../closeout";
import { describeSource, digitTokens, ground, sourceText } from "../grounding";
import type { FunctionTool } from "../meta";
import { Section, type Claim, type Job, type Source } from "../model";
import { sparkOpenJson } from "../spark-open";
import { verifyClaims } from "../verifier";
import { shopChecklist } from "./checklist";
import {
  amounts,
  askedAbout,
  describeConflict,
  describePriceConflict,
  priceConflict,
  refrigerantConflict,
  refrigerants,
} from "./conflicts";
import { asCloseOut, type AgentRun, type ChecklistEntry, type CheckResult, type RunStatus } from "./runs";

// The close-out agent's tools. The checks live inside the tools, at fixed points, so the agent
// cannot skip them: set_checklist checks the checklist against the shop's, ask_tech checks the
// question is about a real gap, and submit_note runs the code checks and the verifier model.
// A refused call returns the problems; the agent fixes them and calls again.

export const MAX_REFUSALS = 3;
const MAX_QUESTIONS = 4;
const MAX_ASK_ROUNDS = 2;

export interface Context {
  job: Job;
  run: AgentRun;
}

export interface ToolResult {
  result: Record<string, unknown>;
  refused?: boolean;
  status?: RunStatus; // set when the run must stop
}

export function allSources(ctx: Context): Source[] {
  return [...ctx.job.sources, ...ctx.run.derived];
}

function askRounds(run: AgentRun): number {
  return new Set(run.questions.map((q) => q.id.split(".")[0])).size;
}

// A refrigerant conflict the technician hasn't been asked about yet, while they still can be.
function unaskedConflict(ctx: Context) {
  const conflict = refrigerantConflict(allSources(ctx), ctx.run);
  if (!conflict || askedAbout(conflict, ctx.run) || askRounds(ctx.run) >= MAX_ASK_ROUNDS) return undefined;
  return conflict;
}

export function nextSourceId(ctx: Context): string {
  return `S${Math.max(...allSources(ctx).map((s) => Number(s.id.slice(1)))) + 1}`;
}

const strictObject = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

const SOURCE_IDS = { type: "array", items: { type: "string" }, description: "source ids, e.g. S2" };

export function definitions(job: Job): FunctionTool[] {
  const items = shopChecklist(job).map((i) => i.id);
  return [
    {
      type: "function",
      name: "read_nameplates",
      description:
        "Read the rating plates (nameplates) and part labels (e.g. a capacitor's MFD rating) in photos. Each " +
        "reading becomes a new source you can cite for make, model, ratings and dates. Call it once with every " +
        "photo that shows a rating plate or a part label.",
      parameters: strictObject({ photos: SOURCE_IDS }),
      strict: true,
    },
    {
      type: "function",
      name: "set_checklist",
      description:
        "Set what this close-out must record: one entry per item of the shop's checklist. status found: the " +
        "sources record it (note says what, sources cite it); ask: missing, unclear or contradictory (note is the " +
        "question for the technician); not_applicable: the item does not apply to this job (note says why). " +
        "Checked against the shop's checklist and the sources; a refused checklist comes back with the problems.",
      parameters: strictObject({
        entries: {
          type: "array",
          items: strictObject({
            item: { type: "string", enum: items },
            status: { type: "string", enum: ["found", "ask", "not_applicable"] },
            note: { type: "string" },
            sources: SOURCE_IDS,
          }),
        },
      }),
      strict: true,
    },
    {
      type: "function",
      name: "ask_tech",
      description:
        `Ask the technician about checklist items marked ask, in one call (at most ${MAX_QUESTIONS} questions). ` +
        "Short, specific questions they can answer in a few words on their phone. The run pauses until they answer; " +
        "each answer becomes a new source you can cite.",
      parameters: strictObject({
        questions: {
          type: "array",
          items: strictObject({ item: { type: "string", enum: items }, question: { type: "string" } }),
        },
      }),
      strict: true,
    },
    {
      type: "function",
      name: "submit_note",
      description:
        "Submit the close-out note. Every line is checked: numbers against the cited sources, then each line " +
        "by a second model (Muse Spark Open) against only the sources it cites. Every checklist item found or " +
        "answered must be covered by a line that lists it in items and cites its source. A refused note comes " +
        "back with the problems.",
      parameters: strictObject({
        lines: {
          type: "array",
          items: strictObject({
            section: { type: "string", enum: Section.options },
            text: { type: "string" },
            items: { type: "array", items: { type: "string", enum: items }, description: "checklist items this line covers" },
            citations: {
              type: "array",
              items: strictObject({
                source: { type: "string" },
                phrase: { type: "string" },
                box: strictObject({
                  left: { type: "integer" },
                  top: { type: "integer" },
                  right: { type: "integer" },
                  bottom: { type: "integer" },
                }),
              }),
            },
          }),
        },
      }),
      strict: true,
    },
  ];
}

export async function runTool(ctx: Context, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  switch (name) {
    case "read_nameplates":
      return readNameplates(ctx, args as { photos: string[] });
    case "set_checklist":
      return setChecklist(ctx, args as { entries: ChecklistEntry[] });
    case "ask_tech":
      return askTech(ctx, args as { questions: { item: string; question: string }[] });
    case "submit_note":
      return submitNote(ctx, args as { lines: SubmittedLine[] });
    default:
      // Not one of our tools: discarded, never run.
      return { result: { error: `Unknown tool ${name}. Use one of the tools you were given.` }, refused: true };
  }
}

// --- read_nameplates ---------------------------------------------------------------------

async function readNameplates(ctx: Context, { photos }: { photos: string[] }): Promise<ToolResult> {
  const byId = new Map(allSources(ctx).map((s) => [s.id, s]));
  const results: Record<string, unknown>[] = [];
  const pending: Extract<Source, { kind: "photo" }>[] = [];
  for (const id of new Set(photos)) {
    const source = byId.get(id);
    const already = ctx.run.derived.find((d) => d.kind === "nameplate" && d.derivedFrom === id);
    if (source?.kind !== "photo") results.push({ photo: id, error: "not a photo source" });
    else if (already) results.push({ photo: id, source: already.id, note: "already read" });
    else pending.push(source);
  }
  const readings = await Promise.all(pending.map((p) => readNameplate(ctx.job, p, "pending")));
  readings.forEach(({ source }, i) => {
    const photo = pending[i].id;
    if (!source) return results.push({ photo, nameplate: false });
    const reading = { ...source, id: nextSourceId(ctx) };
    ctx.run.derived.push(reading);
    results.push({ photo, source: reading.id, fields: reading.kind === "nameplate" ? reading.fields : {} });
  });
  return { result: { readings: results } };
}

// --- set_checklist -----------------------------------------------------------------------

interface Judgement {
  results: { item: string; ok: boolean; problem: string }[];
}

const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "ok", "problem"],
        properties: { item: { type: "string" }, ok: { type: "boolean" }, problem: { type: "string" } },
      },
    },
  },
};

const JUDGE_PROMPT = `You check an HVAC close-out checklist against the job's sources (all of them are given).
Each entry has a status:
- found: the note must be stated in the cited sources. Not ok if the sources don't say it, or if the
  note leaves out something the item asks for that the sources leave unclear (then it should be ask).
- ask: the item must really be missing, unclear or contradictory in the sources; not ok if the
  sources already answer it. The note must be a question for the technician.
- not_applicable: the item must clearly not apply to this job; not ok if the sources suggest it does
  (e.g. refrigerant was added, so "refrigerant added" applies).
Judge by the sources alone. problem: one short sentence saying what is wrong, or "" when ok.`;

async function setChecklist(ctx: Context, { entries }: { entries: ChecklistEntry[] }): Promise<ToolResult> {
  const started = Date.now();
  const shop = shopChecklist(ctx.job);
  const byId = new Map(allSources(ctx).map((s) => [s.id, s]));
  const problems: string[] = [];

  // Code checks: full coverage of the shop's list, and well-formed entries.
  for (const item of shop) {
    const count = entries.filter((e) => e.item === item.id).length;
    if (count === 0) problems.push(`${item.id}: missing (${item.text})`);
    if (count > 1) problems.push(`${item.id}: listed ${count} times; give it one entry`);
  }
  for (const e of entries) {
    const unknown = e.sources.filter((s) => !byId.has(s));
    if (unknown.length) problems.push(`${e.item}: unknown sources ${unknown.join(", ")}`);
    if (e.status === "found" && e.sources.length === 0) problems.push(`${e.item}: found, but cites no source`);
    if (e.status === "found") {
      const cited = new Set(e.sources.flatMap((s) => (byId.has(s) ? digitTokens(sourceText(byId.get(s)!)) : [])));
      // Source ids in the note ("per S3") are not numbers to check.
      const missing = digitTokens(e.note.replace(/\bS\d+\b/g, "")).filter((t) => !cited.has(t));
      if (missing.length) problems.push(`${e.item}: ${missing.join(", ")} not in the cited sources`);
    }
    if (e.status === "ask" && !e.note.trim().endsWith("?")) problems.push(`${e.item}: ask, but the note is not a question`);
    if (e.status === "not_applicable" && !e.note.trim()) problems.push(`${e.item}: say why it does not apply`);
  }
  // The plate and the technician disagree on the refrigerant: ask, naming the plate's.
  const conflict = unaskedConflict(ctx);
  const refrigerant = entries.find((e) => e.item === "refrigerant");
  if (conflict && refrigerant && (refrigerant.status !== "ask" || !refrigerants(refrigerant.note).some((r) => conflict.plate.includes(r)))) {
    problems.push(
      `refrigerant: ${describeConflict(conflict)}. Mark it ask, with a question that names ${conflict.plate.join(" or ")}, ` +
        `e.g. "The plate says ${conflict.plate[0]}: which refrigerant did you add, and how much?"`,
    );
  }

  let by = "code";
  if (problems.length === 0) {
    // Then the second model judges each entry against all the sources.
    by = "code + Muse Spark Open";
    const sources = allSources(ctx)
      .map((s) => describeSource(s))
      .join("\n\n");
    const list = entries
      .map((e) => `- ${e.item} (${shop.find((i) => i.id === e.item)?.text}): ${e.status}: "${e.note}" [${e.sources.join(", ")}]`)
      .join("\n");
    try {
      const { data } = await sparkOpenJson<Judgement>({
        schemaName: "checklist_check",
        schema: JUDGE_SCHEMA,
        messages: [
          { role: "system", content: JUDGE_PROMPT },
          {
            role: "user",
            content: `Sources:\n${sources}\n\nChecklist:\n${list}${
              conflict ? `\n\nFound by code: ${describeConflict(conflict)}. Asking the technician about it is correct.` : ""
            }`,
          },
        ],
      });
      for (const r of data.results) if (!r.ok) problems.push(`${r.item}: ${r.problem}`);
    } catch (error) {
      // The judge is unavailable: accept on the code checks alone, and say so.
      by = `code (Muse Spark Open unavailable: ${(error as Error).message.slice(0, 80)})`;
    }
  }

  const prev = ctx.run.checklist;
  const refusals = (prev?.refusals ?? 0) + (problems.length ? 1 : 0);
  const check: CheckResult = { check: "checklist", passed: problems.length === 0, problems, ms: Date.now() - started, by };
  ctx.run.checks.push(check);

  if (problems.length && refusals < MAX_REFUSALS) {
    // An earlier accepted checklist stays in force; a first checklist is kept to show what was refused.
    ctx.run.checklist = prev?.accepted ? { ...prev, refusals } : { entries, accepted: false, refusals };
    return { result: { error: "checklist refused", problems, refusals, maxRefusals: MAX_REFUSALS }, refused: true };
  }
  // Passed, or refused too often: accepted, and the remaining problems stay on record for the office.
  ctx.run.checklist = { entries, accepted: true, refusals };
  // Items still to ask about: marked ask and not asked already.
  const asks = entries.filter((e) => e.status === "ask" && !ctx.run.questions.some((q) => q.item === e.item));
  return {
    result: {
      accepted: true,
      ...(problems.length && { acceptedWithProblems: problems }),
      next: asks.length
        ? `Ask the technician about: ${asks.map((e) => e.item).join(", ")} (ask_tech).`
        : "Write and submit the note (submit_note).",
    },
  };
}

// --- ask_tech ----------------------------------------------------------------------------

async function askTech(
  ctx: Context,
  { questions }: { questions: { item: string; question: string }[] },
): Promise<ToolResult> {
  const { run } = ctx;
  const refuse = (error: string): ToolResult => ({ result: { error }, refused: true });
  if (!run.checklist?.accepted) return refuse("Set an accepted checklist first (set_checklist).");
  const rounds = askRounds(run);
  if (rounds >= MAX_ASK_ROUNDS) return refuse(`Already asked ${rounds} times. Submit the note with what you have.`);
  if (questions.length === 0 || questions.length > MAX_QUESTIONS) return refuse(`Ask 1 to ${MAX_QUESTIONS} questions.`);

  const problems: string[] = [];
  for (const q of questions) {
    const entry = run.checklist.entries.find((e) => e.item === q.item);
    if (entry?.status !== "ask") problems.push(`${q.item}: not marked ask in your checklist`);
    if (!q.question.trim().endsWith("?")) problems.push(`${q.item}: not a question`);
    if (run.questions.some((p) => p.question.toLowerCase() === q.question.toLowerCase()))
      problems.push(`${q.item}: already asked`);
  }
  if (problems.length) return { result: { error: "questions refused", problems }, refused: true };

  const round = `Q${rounds + 1}`;
  const asked = questions.map((q, i) => ({ id: `${round}.${i + 1}`, item: q.item, question: q.question.trim() }));
  run.questions.push(...asked);
  return { result: { asked: asked.map((q) => q.id), waiting: "for the technician" }, status: "needs_input" };
}

// The technician's answers become sources, so the note can cite them like anything else.
export interface Answer {
  id: string;
  answer: string;
  // The answer is a Muse Voice Transcribe transcript the technician sent as is.
  spoken?: boolean;
  photos?: { file: string; width: number; height: number }[];
}

// Each answer becomes sources: a text source for what the technician wrote (a voice source when
// they spoke it), a photo source per photo. Returns the summary for the model and the new
// photos (so it can be shown them).
export function recordAnswers(ctx: Context, answers: Answer[]): { summary: string; photos: Source[] } {
  const tech = ctx.job.sources.find((s) => s.author.role === "tech")?.author ?? { role: "tech" as const, name: "Technician" };
  const lines: string[] = [];
  const photos: Source[] = [];
  for (const q of ctx.run.questions) {
    const given = answers.find((x) => x.id === q.id);
    if (q.answer !== undefined || !given) continue;
    const a = given.answer.trim();
    const taken = given.photos ?? [];
    q.answer = a || (taken.length ? "(photo)" : "(no answer)");
    if (!a && taken.length === 0) {
      lines.push(`${q.id} (${q.item}): no answer. Leave it open; it goes to the office as an open question.`);
      continue;
    }
    const at = new Date().toISOString();
    if (a) {
      const text = `Answer to "${q.question}": ${a}`;
      const source: Source = given.spoken
        ? { id: nextSourceId(ctx), kind: "voice", at, author: tech, text }
        : { id: nextSourceId(ctx), kind: "text", at, author: tech, text };
      ctx.run.derived.push(source);
      q.answerSource = source.id;
      lines.push(`${q.id} (${q.item}) → ${source.id}: ${source.text}`);
    }
    for (const photo of taken) {
      const source: Source = { id: nextSourceId(ctx), kind: "photo", at, author: tech, photo, caption: `Photo for "${q.question}"` };
      ctx.run.derived.push(source);
      photos.push(source);
      q.answerSource ??= source.id;
      q.photoSources = [...(q.photoSources ?? []), source.id];
      lines.push(`${q.id} (${q.item}) → ${source.id}: photo taken to answer "${q.question}" (shown below)`);
    }
  }
  return { summary: lines.join("\n"), photos };
}

// --- submit_note -------------------------------------------------------------------------

interface SubmittedLine {
  section: Section;
  text: string;
  items: string[];
  citations: { source: string; phrase: string; box: { left: number; top: number; right: number; bottom: number } }[];
}

async function submitNote(ctx: Context, { lines }: { lines: SubmittedLine[] }): Promise<ToolResult> {
  const started = Date.now();
  const { run, job } = ctx;
  if (!run.checklist?.accepted) return { result: { error: "Set an accepted checklist first (set_checklist)." }, refused: true };
  if (lines.length === 0) return { result: { error: "The note has no lines." }, refused: true };
  const unasked = unaskedConflict(ctx);
  if (unasked) {
    // Not counted as a refused note: the technician has to be asked first.
    return {
      result: { error: `Ask first: ${describeConflict(unasked)}. Mark refrigerant ask (set_checklist), then ask_tech.` },
      refused: true,
    };
  }

  const sources = allSources(ctx);
  const byId = new Map(sources.map((s) => [s.id, s]));
  const grounded: Claim[] = lines.map((line, i) =>
    ground(
      {
        id: `c${i + 1}`,
        section: line.section,
        text: line.text,
        citations: line.citations.map((cit) => ({
          source: cit.source,
          ...(byId.get(cit.source)?.kind === "photo" && { region: photoRegion(cit) }),
        })),
        status: "draft",
      },
      byId,
    ),
  );

  // Completeness (code): each checklist item the sources or the technician answered is covered
  // by a line that says it covers the item and cites one of the item's sources.
  const problems: string[] = [];
  for (const e of run.checklist.entries) {
    const answered = run.questions.find((q) => q.item === e.item && q.answerSource);
    const answer = answered ? [answered.answerSource!, ...(answered.photoSources ?? [])] : [];
    const need = [...(e.status === "found" ? e.sources : []), ...new Set(answer)];
    if (need.length === 0) continue;
    const covering = lines.filter((l) => l.items.includes(e.item));
    if (covering.length === 0) problems.push(`${e.item}: no line covers it`);
    else if (!covering.some((l) => l.citations.some((c) => need.includes(c.source))))
      problems.push(`${e.item}: the lines covering it don't cite ${need.join(" or ")}`);
  }

  // A conflict still standing after asking goes in the note for the office: a refrigerant line
  // names both and cites the plate.
  const conflict = refrigerantConflict(sources, run);
  if (conflict) {
    const shown = lines.some(
      (l) =>
        l.items.includes("refrigerant") &&
        l.citations.some((c) => conflict.plateSources.includes(c.source)) &&
        refrigerants(l.text).some((r) => conflict.plate.includes(r)) &&
        refrigerants(l.text).some((r) => conflict.said.includes(r)),
    );
    if (!shown) {
      problems.push(
        `refrigerant: ${describeConflict(conflict)}. A line covering refrigerant must name both and cite ${conflict.plateSources.join(" or ")}.`,
      );
    }
  }

  // A price the technician quoted that isn't in the price book: one line names it beside the
  // book's price and cites both, so the office sees the difference before it bills.
  const offBook = priceConflict(sources, run);
  if (offBook) {
    for (const price of offBook.quoted) {
      const shown = lines.some((l) => {
        const named = new Set(amounts(l.text));
        return (
          named.has(price) &&
          offBook.book.some((p) => named.has(p)) &&
          l.citations.some((c) => offBook.bookSources.includes(c.source)) &&
          l.citations.some((c) => offBook.quotedSources.includes(c.source))
        );
      });
      if (!shown) {
        problems.push(
          `price: ${describePriceConflict(offBook)}. One line must name $${price} and the price book's price for the same item, ` +
            `cite ${offBook.quotedSources.join(" or ")} and ${offBook.bookSources.join(" or ")}, and say they differ.`,
        );
      }
    }
  }

  // Then each line: the code checks (in ground), and the verifier model for the rest.
  const verified = await verifyClaims(job, grounded, sources);
  for (const c of verified.claims) {
    if (c.status === "unsupported" || c.status === "partial") {
      problems.push(`${c.id} "${c.text}": ${c.status === "partial" ? "partly supported" : "not supported"}: ${c.reason}`);
    }
  }
  run.checks.push({
    check: "note",
    passed: problems.length === 0,
    problems,
    ms: Date.now() - started,
    by: `code + Muse Spark Open (${verified.log.calls} lines, ${verified.log.cached} cached)`,
  });
  run.claims = verified.claims;

  if (problems.length) {
    run.noteRefusals++;
    if (run.noteRefusals >= MAX_REFUSALS) {
      await publish(ctx);
      return {
        result: { error: "note refused", problems, escalated: `Refused ${run.noteRefusals} times; the office takes over.` },
        refused: true,
        status: "escalated",
      };
    }
    return {
      result: { error: "note refused", problems, refusals: run.noteRefusals, maxRefusals: MAX_REFUSALS },
      refused: true,
    };
  }
  await publish(ctx);
  return { result: { accepted: true, waiting: "for the office to sign off" }, status: "awaiting_signoff" };
}

// The submitted note becomes the job's latest close-out, so the job page and line edits use it.
async function publish(ctx: Context) {
  const closeOut = asCloseOut(ctx.run, MODEL);
  if (closeOut) await cacheSet("closeouts", ctx.job.id, closeOut);
}
