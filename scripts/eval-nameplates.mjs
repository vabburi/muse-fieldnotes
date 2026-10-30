// Reads every rating plate in evals/nameplates.json through the app at each reasoning effort and
// scores the fields against the hand transcription: right, wrong (a value that isn't on the
// plate, worse than leaving it out), or missing. Needs the app running (APP_URL).
// Usage: node scripts/eval-nameplates.mjs [--efforts minimal,low,high] [--trials 1] [--out file]
// ("default" leaves the effort to the app, which uses minimal.)
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    efforts: { type: "string", default: "default" },
    trials: { type: "string", default: "1" },
    out: { type: "string" },
  },
});
const APP = process.env.APP_URL ?? "http://localhost:3000";
const { plates } = JSON.parse(await readFile("evals/nameplates.json", "utf8"));
const efforts = args.efforts.split(",");
const trials = Number(args.trials);

// Codes must match exactly (spaces aside); other values must contain the expected text.
const CODES = new Set(["product number", "model number"]);
const norm = (v) => v.toUpperCase().replace(/[\s,]/g, "").replace(/^R-?/, "");

function score(expected, fields) {
  const got = Object.fromEntries(Object.entries(fields ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return Object.entries(expected).map(([name, want]) => {
    const value = got[name.toLowerCase()];
    if (value === undefined || value.trim() === "") return { name, want, value, result: "missing" };
    const ok = CODES.has(name) ? norm(value) === norm(want) : norm(value).includes(norm(want));
    return { name, want, value, result: ok ? "right" : "wrong" };
  });
}

async function read(plate, effort, trial) {
  const res = await fetch(`${APP}/api/evals/nameplates`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(process.env.COOKIE && { Cookie: process.env.COOKIE }) },
    // Trials count from 1, so no read comes from the app's own cache.
    body: JSON.stringify({ job: plate.job, source: plate.source, trial: trial + 1, ...(effort !== "default" && { effort }) }),
  });
  const body = await res.json();
  if (!res.ok) return { error: body.error };
  return { ms: body.ms, fields: score(plate.fields, body.fields) };
}

const jobs = efforts.flatMap((effort) => [...Array(trials).keys()].flatMap((trial) => plates.map((plate) => ({ effort, trial, plate }))));
const results = [];
for (let i = 0; i < jobs.length; i += 5) {
  results.push(...(await Promise.all(jobs.slice(i, i + 5).map(async (j) => ({ ...j, ...(await read(j.plate, j.effort, j.trial)) })))));
  process.stderr.write(".");
}
process.stderr.write("\n");

const summary = efforts.map((effort) => {
  const rs = results.filter((r) => r.effort === effort && !r.error);
  const fields = rs.flatMap((r) => r.fields);
  const count = (k) => fields.filter((f) => f.result === k).length;
  const s = {
    effort,
    reads: rs.length,
    errors: results.filter((r) => r.effort === effort && r.error).length,
    right: count("right") / fields.length,
    wrong: count("wrong") / fields.length,
    missing: count("missing") / fields.length,
    msPerPlate: rs.reduce((n, r) => n + r.ms, 0) / (rs.length || 1),
  };
  console.log(
    `${effort.padEnd(8)} ${s.reads} reads: ${(100 * s.right).toFixed(1)}% right, ${(100 * s.wrong).toFixed(1)}% wrong, ` +
      `${(100 * s.missing).toFixed(1)}% missing, ${(s.msPerPlate / 1000).toFixed(1)} s per plate` +
      (s.errors ? `, ${s.errors} errors` : ""),
  );
  return s;
});

console.log("\nWrong values:");
for (const r of results.filter((r) => !r.error))
  for (const f of r.fields.filter((f) => f.result === "wrong"))
    console.log(`  ${r.effort}#${r.trial} ${r.plate.job} ${r.plate.source} ${f.name}: read "${f.value}", plate says "${f.want}"`);
for (const r of results.filter((r) => r.error)) console.log(`  error ${r.effort}#${r.trial} ${r.plate.source}: ${r.error.slice(0, 200)}`);

if (args.out) {
  await mkdir(path.dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify({ at: new Date().toISOString(), summary, results }, null, 2));
}
