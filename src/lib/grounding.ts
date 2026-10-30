import type { Claim, Source } from "./model";

// Deterministic checks that run before any model verifies anything:
// 1. drop citations to sources that don't exist; a claim left with none is unsupported;
// 2. every token containing a digit (amounts, readings, model numbers, sizes) must
//    appear in the text of a cited source. Photos have no text, so a number taken
//    from a photo must cite the nameplate source read from it.

const DIGIT_TOKEN = /[A-Za-z0-9$][\w.,$%/-]*\d[\w.,$%/-]*/g;

function normalize(token: string): string {
  return token
    .toLowerCase()
    .replace(/[$,%]/g, "")
    .replace(/[.\-/]+$/g, "");
}

export function digitTokens(text: string): string[] {
  return [...text.matchAll(DIGIT_TOKEN)].map((m) => normalize(m[0])).filter(Boolean);
}

export function sourceText(source: Source): string {
  switch (source.kind) {
    case "text":
    case "voice":
    case "record":
      return source.text;
    case "nameplate":
      return Object.entries(source.fields)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
    case "photo":
      return source.caption ?? "";
  }
}

export function ground(claim: Claim, sources: Map<string, Source>): Claim {
  const citations = claim.citations.filter((c) => sources.has(c.source));
  const dropped = claim.citations.length - citations.length;
  if (citations.length === 0) {
    return { ...claim, citations: claim.citations, status: "unsupported", reason: "cites no known source", check: { by: "code" } };
  }

  // Compare token sets, normalized the same way, so "88,000" matches "88000".
  const cited = new Set(
    citations.flatMap((c) => digitTokens(sourceText(sources.get(c.source)!))),
  );
  const missing = digitTokens(claim.text).filter((t) => !cited.has(t));

  if (missing.length > 0) {
    return {
      ...claim,
      citations,
      status: "unsupported",
      reason: `${missing.join(", ")} not found in the cited sources`,
      check: { by: "code" },
    };
  }
  return {
    ...claim,
    citations,
    ...(dropped > 0 && { reason: `dropped ${dropped} unknown citation(s)` }),
  };
}

// How a source is shown to a model: a header with id, kind and author, then its content.
export function describeSource(source: Source): string {
  const head = `[${source.id}] ${source.kind} from ${source.author.role} ${source.author.name} at ${source.at}`;
  switch (source.kind) {
    case "photo":
      return `${head}${source.caption ? ` — caption: ${source.caption}` : ""} (image follows, ${source.photo.width}x${source.photo.height} px)`;
    case "nameplate":
      return `${head} — read from photo ${source.derivedFrom}:\n${Object.entries(source.fields)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join("\n")}`;
    default:
      return `${head}:\n${source.text}`;
  }
}
