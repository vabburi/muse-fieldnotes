import "server-only";

import type { Source } from "../model";
import type { AgentRun } from "./runs";

// Conflicts the code can see between what a rating plate says and what the technician said.
// A line can be true to the source it cites (the tech did write "topped off with 410A") and
// still be wrong for the job (the plate says R-454B); the verifier only sees the cited sources,
// so this check looks across all of them.

// R-22 and R-32 need the R ("22" alone is too common); the others are distinctive by themselves.
const REFRIGERANT = /\bR-?\s?(22|32|134A|407C|410A|454B)\b|\b(407C|410A|454B)\b/gi;

export function refrigerants(text: string): string[] {
  return [...new Set([...text.matchAll(REFRIGERANT)].map((m) => `R-${(m[1] ?? m[2]).toUpperCase()}`))];
}

export interface RefrigerantConflict {
  plate: string[]; // on the rating plates
  said: string[]; // named by the technician, not on any plate
  plateSources: string[];
  saidSources: string[];
}

// What the technician said, as text: their notes and voice notes, and their answers without
// the question in front (the question is the agent's words).
function techSays(sources: Source[], run: AgentRun): { id: string; text: string }[] {
  const asked = new Map(run.questions.filter((q) => q.answerSource).map((q) => [q.answerSource!, q]));
  return sources.flatMap((s) => {
    if (s.author.role !== "tech" || (s.kind !== "text" && s.kind !== "voice")) return [];
    const q = asked.get(s.id);
    const prefix = q ? `Answer to "${q.question}": ` : "";
    return [{ id: s.id, text: s.text.startsWith(prefix) ? s.text.slice(prefix.length) : s.text }];
  });
}

export function refrigerantConflict(sources: Source[], run: AgentRun): RefrigerantConflict | undefined {
  const plates = sources.flatMap((s) =>
    s.kind === "nameplate"
      ? Object.entries(s.fields)
          .filter(([k]) => /refrigerant/i.test(k))
          .flatMap(([, v]) => refrigerants(v).map((r) => ({ id: s.id, r })))
      : [],
  );
  if (plates.length === 0) return undefined;
  const plate = new Set(plates.map((p) => p.r));

  // The technician's answer to a refrigerant question is their latest word, when it names one.
  const says = techSays(sources, run).map((t) => ({ ...t, names: refrigerants(t.text) }));
  const answers = new Set(run.questions.filter((q) => q.item === "refrigerant").map((q) => q.answerSource));
  const latest = says.filter((t) => answers.has(t.id) && t.names.length);
  const named = (latest.length ? latest : says).flatMap((t) => t.names.map((r) => ({ id: t.id, r })));

  const off = named.filter((n) => !plate.has(n.r));
  if (off.length === 0) return undefined;
  return {
    plate: [...plate],
    said: [...new Set(off.map((n) => n.r))],
    plateSources: [...new Set(plates.map((p) => p.id))],
    saidSources: [...new Set(off.map((n) => n.id))],
  };
}

export function describeConflict(c: RefrigerantConflict): string {
  return `the rating plate (${c.plateSources.join(", ")}) says ${c.plate.join(" or ")}, but the technician (${c.saidSources.join(", ")}) says ${c.said.join(", ")}`;
}

// Whether the technician has been asked about it: a refrigerant question naming the plate's.
export function askedAbout(c: RefrigerantConflict, run: AgentRun): boolean {
  return run.questions.some((q) => q.item === "refrigerant" && refrigerants(q.question).some((r) => c.plate.includes(r)));
}
