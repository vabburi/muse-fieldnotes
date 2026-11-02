// The code checks the agent can't skip: number grounding, the refrigerant and price conflicts,
// the shop checklist. No model calls; run with npm test.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import { shopChecklist } from "../src/lib/agent/checklist.ts";
import { askedAbout, priceConflict, prices, refrigerantConflict, refrigerants } from "../src/lib/agent/conflicts.ts";
import type { AgentRun, Question } from "../src/lib/agent/runs.ts";
import { digitTokens, ground } from "../src/lib/grounding.ts";
import { Job, type Claim, type Source } from "../src/lib/model.ts";

const at = "2026-10-30T10:00:00-05:00";
const tech = { role: "tech" as const, name: "Sam Reyes" };
const said = (id: string, text: string, kind: "text" | "voice" = "voice"): Source => ({ id, kind, at, author: tech, text });
const plate = (id: string, refrigerant: string): Source => ({
  id,
  kind: "nameplate",
  at,
  author: { role: "system", name: "Muse Spark" },
  derivedFrom: "S2",
  fields: { Model: "RD16AY48AJVCA", "Refrigerant (R454B)": refrigerant },
});
const run = (questions: Question[] = []) => ({ questions }) as AgentRun;
const claim = (text: string, ...sources: string[]): Claim => ({
  id: "c1",
  section: "Done",
  text,
  citations: sources.map((source) => ({ source })),
  status: "draft",
});

describe("refrigerants", () => {
  it("normalizes the ways technicians write them", () => {
    assert.deepEqual(refrigerants("topped off with 410A"), ["R-410A"]);
    assert.deepEqual(refrigerants("R454B, r-22 and R 32"), ["R-454B", "R-22", "R-32"]);
    assert.deepEqual(refrigerants("It was our 454 B, about two pounds"), ["R-454B"]);
  });
  it("doesn't read bare numbers as refrigerants", () => {
    assert.deepEqual(refrigerants("supply 22, return 32, 454 lbs"), []);
  });
});

describe("refrigerantConflict", () => {
  it("flags what the technician said against the plate", () => {
    const c = refrigerantConflict([plate("S6", "R-454B 3.2 Kg"), said("S3", "topped it off with 410A")], run());
    assert.deepEqual(c, { plate: ["R-454B"], said: ["R-410A"], plateSources: ["S6"], saidSources: ["S3"] });
  });
  it("is quiet when they agree, or when no plate names one", () => {
    assert.equal(refrigerantConflict([plate("S6", "R-454B"), said("S3", "added R-454B")], run()), undefined);
    assert.equal(refrigerantConflict([said("S3", "added 410A")], run()), undefined);
  });
  it("ignores what the office or the price book says", () => {
    const book: Source = { id: "S4", kind: "record", at, author: { role: "system", name: "Price book" }, text: "R-410A per pound: $95" };
    assert.equal(refrigerantConflict([plate("S6", "R-454B"), book], run()), undefined);
  });
  it("takes the technician's answer to a refrigerant question as their latest word", () => {
    const q: Question = { id: "Q1", item: "refrigerant", question: "The plate says R-454B; which refrigerant did you add?", answer: "454B", answerSource: "S7" };
    const answer = said("S7", `Answer to "${q.question}": 454B, 2 lbs`);
    const sources = [plate("S6", "R-454B"), said("S3", "topped it off with 410A"), answer];
    assert.equal(refrigerantConflict(sources, run([q])), undefined);
  });
  it("doesn't count the plate's refrigerant named in the question as the technician's", () => {
    const q: Question = { id: "Q1", item: "refrigerant", question: "The plate says R-454B; which refrigerant did you add?", answer: "410A", answerSource: "S7" };
    const answer = said("S7", `Answer to "${q.question}": 410A`, "text");
    const c = refrigerantConflict([plate("S6", "R-454B"), said("S3", "added 410A"), answer], run([q]));
    assert.deepEqual(c?.said, ["R-410A"]);
    assert.deepEqual(c?.saidSources, ["S7"]);
    assert.equal(askedAbout(c!, run([q])), true);
  });
  it("counts as asked only when the question names the plate's refrigerant", () => {
    const c = refrigerantConflict([plate("S6", "R-454B"), said("S3", "added 410A")], run())!;
    const vague: Question = { id: "Q1", item: "refrigerant", question: "How much refrigerant did you add?" };
    assert.equal(askedAbout(c, run([vague])), false);
  });
});

describe("priceConflict", () => {
  const book: Source = {
    id: "S4",
    kind: "record",
    at,
    author: { role: "system", name: "Price book" },
    text: "R454B-LB Refrigerant R-454B, per pound: $110. LEAK-01 Electronic leak search: $249.",
  };
  const asked = (question: string, answer: string, id = "S7") => ({
    q: { id: "Q1", item: "recommendation", question, answer, answerSource: id } as Question,
    s: said(id, `Answer to "${question}": ${answer}`, "text"),
  });
  it("reads dollar amounts however they're written", () => {
    assert.deepEqual(prices("$1,249.00, $ 95 and 283 dollars"), ["1249", "95", "283"]);
  });
  it("flags a bare number answering a price question when the book doesn't have it", () => {
    const { q, s } = asked("What price did you quote for leak search?", "283");
    assert.deepEqual(priceConflict([book, s], run([q])), { book: ["110", "249"], quoted: ["283"], bookSources: ["S4"], quotedSources: ["S7"] });
  });
  it("is quiet when the quote matches the book", () => {
    const { q, s } = asked("What price did you quote for leak search?", "249");
    assert.equal(priceConflict([book, s], run([q])), undefined);
  });
  it("reads only the dollar amounts when the answer has one", () => {
    const { q, s } = asked("What did you quote?", "$249 for the search, and 2 lbs at book price");
    assert.equal(priceConflict([book, s], run([q])), undefined);
  });
  it("ignores numbers in answers to questions that aren't about a price", () => {
    for (const question of ["How many pounds did you add?", "What pressures showed low charge?"]) {
      const { q, s } = asked(question, "suction 98 psi, superheat 24, added 5");
      assert.equal(priceConflict([book, s], run([q])), undefined);
    }
  });
  it("flags a dollar amount anywhere the technician speaks", () => {
    assert.deepEqual(priceConflict([book, said("S5", "Told them $199 for the leak search")], run())?.quoted, ["199"]);
  });
});

describe("ground", () => {
  const sources = new Map<string, Source>([
    ["S3", said("S3", "Supply air 57, return 76. Added about two pounds.")],
    ["S4", { id: "S4", kind: "record", at, author: { role: "system", name: "Price book" }, text: "LEAK-01 Electronic leak search: $249." }],
  ]);
  it("passes numbers that appear in the cited source", () => {
    assert.equal(ground(claim("Supply 57°F, return 76°F", "S3"), sources).status, "draft");
    assert.equal(ground(claim("Quoted a leak search at $249", "S4"), sources).status, "draft");
  });
  it("refuses a number the cited source doesn't have", () => {
    const g = ground(claim("Added 3 lbs of refrigerant", "S3"), sources);
    assert.equal(g.status, "unsupported");
    assert.match(g.reason!, /3 not found/);
  });
  it("refuses a number that is only in a source the line didn't cite", () => {
    assert.equal(ground(claim("Leak search quoted at $249", "S3"), sources).status, "unsupported");
  });
  it("refuses a line whose citations don't exist", () => {
    assert.equal(ground(claim("Coil rinsed", "S9"), sources).status, "unsupported");
  });
  it("matches numbers however they're punctuated", () => {
    assert.deepEqual(digitTokens("$1,249.00 and 88,000 BTU"), ["1249.00", "88000"]);
  });
});

describe("fixtures and the shop checklist", async () => {
  const dir = path.join(import.meta.dirname, "..", "fixtures", "jobs");
  const ids = (await readdir(dir)).filter((d) => d.startsWith("job-"));
  for (const id of ids) {
    it(`${id} is valid and has a checklist`, async () => {
      const job = Job.parse(JSON.parse(await readFile(path.join(dir, id, "job.json"), "utf8")));
      const items = shopChecklist(job).map((i) => i.id);
      assert.ok(items.includes("equipment") && items.includes("repair"));
      assert.equal(new Set(items).size, items.length, "checklist ids are unique");
    });
  }
  it("job-004 needs the refrigerant question", async () => {
    const job = Job.parse(JSON.parse(await readFile(path.join(dir, "job-004", "job.json"), "utf8")));
    assert.ok(shopChecklist(job).some((i) => i.id === "refrigerant"));
    assert.deepEqual(refrigerants(job.sources.map((s) => ("text" in s ? s.text : "")).join(" ")).includes("R-410A"), true);
  });
});
