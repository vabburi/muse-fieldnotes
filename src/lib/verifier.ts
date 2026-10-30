import "server-only";

import { cacheGet, cacheSet, hashKey } from "./cache";
import { photoDataUrl } from "./fixtures";
import { describeSource } from "./grounding";
import type { ContentPart, ReasoningEffort } from "./meta";
import type { Claim, FollowUp, Job, Source } from "./model";
import { providerChain, sparkOpenJson, type ProviderName, type Usage } from "./spark-open";

// Step 3 of the close-out: a different model on different infrastructure (Muse Spark Open on
// Baseten, failing over to Fireworks and Modal) checks every line that passed the code checks
// against only the sources it cites.

interface Verdict {
  status: "supported" | "partial" | "unsupported";
  reason: string;
  question: string;
}

const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "reason", "question"],
  properties: {
    status: { type: "string", enum: ["supported", "partial", "unsupported"] },
    reason: { type: "string" },
    question: { type: "string" },
  },
};

const VERIFY_PROMPT = `You check one line of an HVAC job close-out note against the sources it cites.
You see only those sources. Judge the line by them alone, not by what is likely or typical.
Judge only what the line itself claims. Who reported something, or which record it came from,
does not matter unless the line states it.

- supported: everything the line says is stated in or clearly shown by the sources.
  Rewording is fine; a summary in plain words is fine when the meaning is unchanged.
- partial: the main point is supported but some detail is not (an extra fact, a stronger word,
  a number or name that the sources don't give).
- unsupported: the main point is missing from the sources or contradicts them.

Numbers, codes and units must match the sources exactly. When a nameplate reading is cited, its
photo is included: also check that the numbers the line uses are what the photo shows; a misread
character makes the line partial. Ignore anything redacted with black boxes.

reason: one short sentence a technician would understand, naming what is or isn't supported.
question: for partial, one short question to the technician about the job that would settle it
(e.g. "Was the evaporator coil dirty?"), never about the sources; otherwise "".`;

export interface VerifierLog {
  model: string;
  // Lines checked by each host, and lines that had to fail over.
  providers: Partial<Record<ProviderName, number>>;
  failedOver: number;
  calls: number;
  cached: number;
  failed: number;
  tokens: { prompt: number; completion: number };
  ms: number;
}

// Sources to show for one line: the cited ones, plus the photo behind any cited nameplate.
function evidenceFor(claim: Claim, byId: Map<string, Source>): Source[] {
  const ids = new Set<string>();
  for (const c of claim.citations) {
    const source = byId.get(c.source);
    if (!source) continue;
    ids.add(source.id);
    if (source.kind === "nameplate") ids.add(source.derivedFrom);
  }
  return [...ids].map((id) => byId.get(id)!);
}

async function content(job: Job, claim: Claim, evidence: Source[]): Promise<ContentPart[]> {
  const line = `Line (${claim.section}): "${claim.text}" [${claim.citations.map((c) => c.source).join(", ")}]`;
  // The line goes first and last: with long sources (photos) in between, a line only at the
  // end was occasionally missed.
  const parts: ContentPart[] = [{ type: "text", text: `${line}\n\nSources:` }];
  for (const source of evidence) {
    parts.push({ type: "text", text: describeSource(source) });
    if (source.kind === "photo") {
      parts.push({ type: "image_url", image_url: { url: await photoDataUrl(job.id, source.photo.file) } });
    }
  }
  parts.push({ type: "text", text: `Check this ${line}` });
  return parts;
}

interface Checked {
  verdict: Verdict;
  provider: ProviderName;
  model: string;
  failedOver: number;
  ms: number;
  usage?: Usage;
  requestId?: string;
}

// For evals: pin one host, set the reasoning effort (the app uses low), and repeat a trial
// (each trial is cached on its own, so an interrupted sweep resumes).
export interface VerifyOptions {
  only?: ProviderName;
  effort?: ReasoningEffort;
  trial?: number;
}

// One line, on the first host that answers. Cached by host chain, prompt, line and the exact
// cited content (photos included), so regenerating a note only pays for lines that changed.
async function verifyOne(job: Job, claim: Claim, byId: Map<string, Source>, { only, effort, trial }: VerifyOptions) {
  const parts = await content(job, claim, evidenceFor(claim, byId));
  const chain = providerChain(only).map((p) => `${p.name}:${p.model}`);
  const variant = effort || trial ? [`${effort ?? "low"}#${trial ?? 0}`] : [];
  const key = hashKey(chain.join(","), VERIFY_PROMPT, JSON.stringify(parts), ...variant);
  const cached = await cacheGet<Checked>("verdicts", key);
  if (cached?.provider) return { ...cached, cached: true };

  const result = await sparkOpenJson<Verdict>({
    only,
    reasoningEffort: effort,
    schemaName: "verdict",
    schema: VERDICT_SCHEMA,
    messages: [
      { role: "system", content: VERIFY_PROMPT },
      { role: "user", content: parts },
    ],
  });
  const checked: Checked = {
    verdict: result.data,
    provider: result.provider,
    model: result.model,
    failedOver: result.failedOver.length,
    ms: result.ms,
    usage: result.usage,
    requestId: result.requestId,
  };
  await cacheSet("verdicts", key, checked);
  return { ...checked, cached: false };
}

const STATUS = { supported: "verified", partial: "partial", unsupported: "unsupported" } as const;

// Verifies every line still marked "draft", in parallel. A line no host could check is marked
// "unverified" rather than blocking the note. Partial lines raise a follow-up question.
export async function verifyClaims(job: Job, claims: Claim[], sources: Source[], opts: VerifyOptions = {}) {
  const { only } = opts;
  const started = Date.now();
  const byId = new Map(sources.map((s) => [s.id, s]));
  // With no host configured, each line below fails and is marked "unverified".
  let model = "muse-spark-open";
  try {
    model = providerChain(only)[0].model;
  } catch {}
  const log: VerifierLog = {
    model,
    providers: {},
    failedOver: 0,
    calls: 0,
    cached: 0,
    failed: 0,
    tokens: { prompt: 0, completion: 0 },
    ms: 0,
  };
  const followUps: FollowUp[] = [];

  const verified = await Promise.all(
    claims.map(async (claim): Promise<Claim> => {
      if (claim.status !== "draft") return claim;
      try {
        const result = await verifyOne(job, claim, byId, opts);
        const { verdict, usage } = result;
        log.calls++;
        log.providers[result.provider] = (log.providers[result.provider] ?? 0) + 1;
        if (result.failedOver) log.failedOver++;
        if (result.cached) log.cached++;
        else if (usage) {
          log.tokens.prompt += usage.prompt_tokens;
          log.tokens.completion += usage.completion_tokens;
        }
        if (verdict.status === "partial" && verdict.question) {
          followUps.push({ question: verdict.question, about: claim.id });
        }
        return {
          ...claim,
          status: STATUS[verdict.status],
          reason: verdict.reason,
          check: {
            by: "verifier",
            model: result.model,
            provider: result.provider,
            requestId: result.requestId,
            ms: result.ms,
            ...(usage && { tokens: { prompt: usage.prompt_tokens, completion: usage.completion_tokens } }),
            cached: result.cached,
          },
        };
      } catch (error) {
        log.failed++;
        return {
          ...claim,
          status: "unverified",
          reason: `Verifier unavailable: ${(error as Error).message.slice(0, 200)}`,
          check: { by: "verifier", model },
        };
      }
    }),
  );

  log.ms = Date.now() - started;
  return { claims: verified, followUps, log };
}
