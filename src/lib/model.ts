import { z } from "zod";

// The evidence chain: a Job holds Sources (what the technician and office actually
// sent); a CloseOut holds Claims, and every Claim cites Sources by id.

export const SourceId = z.string().regex(/^S\d+$/, "source ids look like S1, S2, …");

export const Person = z.object({
  role: z.enum(["tech", "office", "customer", "system"]),
  name: z.string().min(1),
});

// Pixel box in the photo's own coordinates, half-open on the right and bottom.
export const Box = z.object({
  left: z.number().int().nonnegative(),
  top: z.number().int().nonnegative(),
  right: z.number().int().positive(),
  bottom: z.number().int().positive(),
});

const SourceBase = z.object({
  id: SourceId,
  at: z.iso.datetime({ offset: true }),
  author: Person,
});

export const Source = z.discriminatedUnion("kind", [
  // A typed message: tech, office or customer.
  SourceBase.extend({ kind: z.literal("text"), text: z.string().min(1) }),
  // A voice note; `text` is the Muse Voice Transcribe transcript.
  SourceBase.extend({
    kind: z.literal("voice"),
    text: z.string().min(1),
    audio: z.object({ file: z.string(), seconds: z.number().positive() }).optional(),
  }),
  SourceBase.extend({
    kind: z.literal("photo"),
    photo: z.object({
      file: z.string(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    caption: z.string().optional(),
  }),
  // Office data: job ticket, customer history, price book.
  SourceBase.extend({ kind: z.literal("record"), text: z.string().min(1) }),
  // Fields read off a nameplate photo by Muse Spark. Derived, so it points back at
  // the photo, and the verifier checks the fields against that photo.
  SourceBase.extend({
    kind: z.literal("nameplate"),
    derivedFrom: SourceId,
    fields: z.record(z.string(), z.string()),
  }),
]);

export const Job = z
  .object({
    id: z.string().regex(/^job-\d{3}$/),
    title: z.string().min(1),
    trade: z.literal("hvac"),
    // What the customer called about; picks the shop's close-out checklist.
    callType: z.enum(["no-heat", "no-cool", "maintenance"]).optional(),
    // Every fixture is invented; this flag makes that explicit in the data itself.
    synthetic: z.literal(true),
    sources: z.array(Source).min(1),
    // What a correct close-out must contain, for the evals.
    expect: z
      .object({
        why: z.boolean(),
        recommendation: z.string().optional(),
        mustMention: z.array(z.string()).default([]),
        // Gaps a correct close-out asks the technician about (a word each question must contain).
        mustAsk: z.array(z.string()).default([]),
      })
      .optional(),
  })
  .superRefine((job, ctx) => {
    const ids = new Set<string>();
    for (const source of job.sources) {
      if (ids.has(source.id)) ctx.addIssue({ code: "custom", message: `duplicate source ${source.id}` });
      ids.add(source.id);
    }
    for (const source of job.sources) {
      if (source.kind === "nameplate" && !ids.has(source.derivedFrom)) {
        ctx.addIssue({ code: "custom", message: `${source.id} derives from unknown ${source.derivedFrom}` });
      }
    }
  });

export const Section = z.enum(["Found", "Done", "Parts", "Quoted", "Why", "Follow-up", "Notes"]);

export const Citation = z.object({
  source: SourceId,
  // For photos: what to highlight. SAM 3.1 tries the phrase first, then the box.
  region: z.object({ phrase: z.string().optional(), box: Box.optional() }).optional(),
});

export const ClaimStatus = z.enum([
  "draft", // written by the drafter, not checked yet
  "verified", // the verifier found it supported by its sources
  "partial", // partly supported; becomes a follow-up question
  "unsupported", // dropped from the note
  "unverified", // the verifier could not run; shown with a warning
]);

export const Claim = z.object({
  id: z.string(),
  section: Section,
  text: z.string().min(1),
  citations: z.array(Citation).min(1, "every claim cites at least one source"),
  status: ClaimStatus,
  reason: z.string().optional(),
  // Which check set the status: the code checks, or the verifier model.
  check: z
    .object({
      by: z.enum(["code", "verifier"]),
      model: z.string().optional(),
      // Which host ran the verifier model (Muse Spark Open on Baseten, Fireworks or Modal).
      provider: z.enum(["baseten", "fireworks", "modal"]).optional(),
      requestId: z.string().optional(),
      ms: z.number().optional(),
      tokens: z.object({ prompt: z.number(), completion: z.number() }).optional(),
      cached: z.boolean().optional(),
    })
    .optional(),
});

export const FollowUp = z.object({
  question: z.string().min(1),
  about: z.string().optional(), // the claim id that raised it
});

export const CloseOut = z.object({
  jobId: z.string(),
  model: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  claims: z.array(Claim),
  followUps: z.array(FollowUp),
});

export type Person = z.infer<typeof Person>;
export type Box = z.infer<typeof Box>;
export type Source = z.infer<typeof Source>;
export type Job = z.infer<typeof Job>;
export type Section = z.infer<typeof Section>;
export type Citation = z.infer<typeof Citation>;
export type ClaimStatus = z.infer<typeof ClaimStatus>;
export type Claim = z.infer<typeof Claim>;
export type FollowUp = z.infer<typeof FollowUp>;
export type CloseOut = z.infer<typeof CloseOut>;
