import "server-only";

import { cacheGet, cacheSet, hashKey } from "./cache";
import { photoDataUrl } from "./fixtures";
import { describeSource, ground } from "./grounding";
import { chatJson, type ContentPart, type ReasoningEffort } from "./meta";
import { Section, type Box, type Claim, type CloseOut, type FollowUp, type Job, type Source } from "./model";
import { verifyClaims, type VerifierLog } from "./verifier";

export const MODEL = process.env.MODEL_ID ?? "muse-spark-1.3";

export interface CloseOutRun {
  closeOut: CloseOut;
  // Sources the agent added (nameplate readings), so the UI can show and cite them.
  derived: Source[];
  timings: Record<string, number>;
  verifier?: VerifierLog;
  // Set when the close-out agent wrote this note (the run has the full trace).
  agentRunId?: string;
}

export type Effort = "low" | "medium" | "high";

// --- Step 1: read nameplates into citable text -------------------------------------

interface NameplateReading {
  isNameplate: boolean;
  fields: { name: string; value: string }[];
}

const NAMEPLATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["isNameplate", "fields"],
  properties: {
    isNameplate: { type: "boolean" },
    fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "value"],
        properties: { name: { type: "string" }, value: { type: "string" } },
      },
    },
  },
};

const NAMEPLATE_PROMPT = `You read HVAC equipment rating plates (nameplates) and the printed labels of parts
(capacitors, motors, contactors).
If this photo is not mainly a rating plate or a part's label, return isNameplate false and no fields.
If it is, transcribe these fields exactly as printed, character by character, when present:
part, manufacturer, product number, model number, date of manufacture, input BTU/hr, output BTU/hr,
voltage/phase, refrigerant, factory charge, compressor RLA, compressor LRA, minimum circuit ampacity,
max fuse or breaker, max unit amps, motor HP, fuel type, capacitance (MFD).
Take each value from next to its own label; do not move a value to a similar label (e.g. a max
fuse rating is not max unit amps).
Long codes are easy to misread: count repeated characters carefully. Never guess a value;
leave out a field you cannot read clearly. Skip anything redacted.`;

// Reads one photo's nameplate, cached by image content, so the slow read happens once:
// at upload time for real jobs, and on the first run for fixtures. Minimal effort read every
// field the higher efforts did, 3.5x faster than the default (scripts/eval-nameplates.mjs).
// Evals can set another effort and repeat a trial.
const NAMEPLATE_EFFORT: ReasoningEffort = "minimal";

export async function readNameplate(
  job: Job,
  photo: Extract<Source, { kind: "photo" }>,
  id: string,
  { effort = NAMEPLATE_EFFORT, trial }: { effort?: ReasoningEffort; trial?: number } = {},
) {
  const url = await photoDataUrl(job.id, photo.photo.file);
  const key = hashKey(MODEL, NAMEPLATE_PROMPT, url, effort, ...(trial ? [`#${trial}`] : []));
  const cached = await cacheGet<NameplateReading>("nameplates", key);
  const started = Date.now();
  const data =
    cached ??
    (
      await chatJson<NameplateReading>({
        schemaName: "nameplate",
        schema: NAMEPLATE_SCHEMA,
        reasoningEffort: effort,
        messages: [
          { role: "system", content: NAMEPLATE_PROMPT },
          { role: "user", content: [{ type: "image_url", image_url: { url } }] },
        ],
      })
    ).data;
  if (!cached) await cacheSet("nameplates", key, data);
  const ms = Date.now() - started;

  if (!data.isNameplate || data.fields.length === 0) return { source: null, ms };
  const source: Source = {
    id,
    kind: "nameplate",
    at: photo.at,
    author: { role: "system", name: `Nameplate reading (${MODEL})` },
    derivedFrom: photo.id,
    fields: Object.fromEntries(data.fields.map((f) => [f.name, f.value])),
  };
  return { source, ms };
}

// --- Step 2: draft cited lines ------------------------------------------------------

interface Draft {
  claims: {
    section: Section;
    text: string;
    citations: { source: string; phrase: string; box: { left: number; top: number; right: number; bottom: number } }[];
  }[];
  followUps: { question: string }[];
}

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["claims", "followUps"],
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "text", "citations"],
        properties: {
          section: { type: "string", enum: Section.options },
          text: { type: "string" },
          citations: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["source", "phrase", "box"],
              properties: {
                source: { type: "string" },
                phrase: { type: "string" },
                box: {
                  type: "object",
                  additionalProperties: false,
                  required: ["left", "top", "right", "bottom"],
                  properties: {
                    left: { type: "integer" },
                    top: { type: "integer" },
                    right: { type: "integer" },
                    bottom: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
    },
    followUps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question"],
        properties: { question: { type: "string" } },
      },
    },
  },
};

// How a close-out note is written; shared by the one-pass drafter and the agent.
export const NOTE_RULES = `Sections, in this order:
- Found: start with one line for the reported problem, then what the technician found.
- Done: work performed and the result.
- Parts: parts or materials used.
- Quoted: prices offered, only from a price book or office record.
- Why: the technician's reasoning for any recommendation, close to their own words.
- Follow-up: what happens next.
- Notes: anything else the office or the next technician needs. Equipment details go in ONE
  line (make, product number, model, date of manufacture, input/output), not one line each.

Rules:
- Aim for 10 to 15 lines in total. Combine closely related facts from the same sources into
  one line (e.g. symptoms of the same fault; a reading before and after a repair).
  Keep separate lines for facts that come from different sources.
- Keep each line under about 25 words; it is read on a phone. Split a line rather than run on.
- Plain sentences a homeowner could follow. No filler, no repeating a fact in two sections.
- Do not state anything the sources do not say, including "none" or "no parts" for things not mentioned.
- Every line cites the source ids (S1, S2, ...) that directly support it. No citation, no line.
- Use only what the sources say. Do not calculate anything: no discounts, totals, or ages.
- Copy numbers, codes, and units exactly as written in the cited source.
- Numbers read off a nameplate must cite the nameplate reading source, not just the photo.
- When a line is about something visible in a photo, also cite the photo. For that citation set
  "box" to a tight bounding box around the thing, in that photo's pixel coordinates (sizes are
  given with each photo), and "phrase" to one or two everyday words for what it looks like, the kind a child
  would use: "label", "metal box", "pipe", "wire", "red box". Never trade terms such as
  "rating plate", "furnace", or "air handler"; the segmentation model does not know them.
  For non-photo citations set "phrase" to "" and every box value to 0.
- Leave out a section that has nothing to say.`;

const DRAFT_PROMPT = `You write the close-out note for a residential HVAC service job, from the job's sources only.
The reader is the office, the comfort advisor, or the next technician: they want the job at a glance.

${NOTE_RULES}
- followUps: questions to ask the technician when something a close-out needs is missing,
  unclear, or contradictory. Ask when, for example:
  - a part, size or amount used is not recorded (which capacitor, how many pounds of refrigerant);
  - the site has more than one system and the notes don't say which one had the problem;
  - the technician's notes conflict or are garbled (e.g. "no heat" and "very hot" together);
  - a test or repair is mentioned as needed but its result is not recorded.
  Short, specific questions the technician can answer in a few words. Do not ask about things
  already stated.`;

async function draft(job: Job, sources: Source[], effort?: Effort) {
  const content: ContentPart[] = [{ type: "text", text: `Job: ${job.title}\n\nSources:` }];
  for (const source of sources) {
    content.push({ type: "text", text: describeSource(source) });
    if (source.kind === "photo") {
      content.push({ type: "image_url", image_url: { url: await photoDataUrl(job.id, source.photo.file) } });
    }
  }
  return chatJson<Draft>({
    schemaName: "closeout",
    schema: DRAFT_SCHEMA,
    messages: [
      { role: "system", content: DRAFT_PROMPT },
      { role: "user", content },
    ],
    reasoningEffort: effort,
  });
}

// --- The agent ----------------------------------------------------------------------

export function photoRegion(cit: { phrase: string; box: Box }) {
  const { box, phrase } = cit;
  const hasBox = box.right > box.left && box.bottom > box.top;
  return { ...(phrase && { phrase }), ...(hasBox && { box }) };
}

export async function runCloseOut(job: Job, opts: { effort?: Effort; verify?: boolean } = {}): Promise<CloseOutRun> {
  const timings: Record<string, number> = {};
  const photos = job.sources.filter((s): s is Extract<Source, { kind: "photo" }> => s.kind === "photo");
  let nextId = Math.max(...job.sources.map((s) => Number(s.id.slice(1)))) + 1;

  const readings = await Promise.all(photos.map((p) => readNameplate(job, p, `S${nextId++}`)));
  timings.nameplates = Math.max(0, ...readings.map((r) => r.ms));
  const derived = readings.flatMap((r) => (r.source ? [r.source] : []));
  const sources = [...job.sources, ...derived];

  // Low effort measured 3x faster than default on job-001 with the same required facts.
  const { data, ms } = await draft(job, sources, opts.effort ?? "low");
  timings.draft = ms;

  const byId = new Map(sources.map((s) => [s.id, s]));
  const grounded: Claim[] = data.claims.map((c, i) =>
    ground(
      {
        id: `c${i + 1}`,
        section: c.section,
        text: c.text,
        citations: c.citations.map((cit) => ({
          source: cit.source,
          ...(byId.get(cit.source)?.kind === "photo" && { region: photoRegion(cit) }),
        })),
        status: "draft",
      },
      byId,
    ),
  );

  // Lines that survive the code checks go to the verifier model (Muse Spark Open).
  const followUps: FollowUp[] = data.followUps.map((f) => ({ question: f.question }));
  let claims = grounded;
  let verifier: VerifierLog | undefined;
  if (opts.verify !== false) {
    const checked = await verifyClaims(job, grounded, sources);
    claims = checked.claims;
    followUps.push(...checked.followUps);
    verifier = checked.log;
    timings.verify = checked.log.ms;
  }

  return {
    closeOut: { jobId: job.id, model: MODEL, createdAt: new Date().toISOString(), claims, followUps },
    derived,
    timings,
    verifier,
  };
}
