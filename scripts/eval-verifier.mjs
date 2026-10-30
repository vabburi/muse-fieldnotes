// Runs the seeded eval lines through the verify route and scores the verdicts: how many match
// the expected status, how many good lines pass, how many seeded bad lines are caught. Compare
// hosts, or sweep reasoning efforts with repeats. Needs the app running (APP_URL).
// Usage: node scripts/eval-verifier.mjs [--suites evals/job-001.lines.json,evals/job-003.lines.json]
//          [--hosts fireworks] [--efforts low,medium] [--trials 1] [--out evals/results/verifier.json]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    suites: { type: "string", default: "evals/job-001.lines.json,evals/job-003.lines.json" },
    hosts: { type: "string", default: "fireworks" },
    efforts: { type: "string", default: "low" },
    trials: { type: "string", default: "1" },
    out: { type: "string" },
  },
});
const APP = process.env.APP_URL ?? "http://localhost:3000";
const suites = await Promise.all(args.suites.split(",").map(async (f) => JSON.parse(await readFile(f, "utf8"))));
const hosts = args.hosts.split(",");
const efforts = args.efforts.split(",");
const trials = Number(args.trials);

async function check(suite, provider, effort, trial) {
  const claims = suite.claims.map(({ section, text, citations }) => ({ section, text, citations }));
  const started = Date.now();
  const res = await fetch(`${APP}/api/jobs/${suite.job}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(process.env.COOKIE && { Cookie: process.env.COOKIE }) },
    body: JSON.stringify({ claims, provider, effort, trial, derived: suite.derived }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${suite.job} ${provider} ${effort}#${trial}: ${body.error}`);
  return { ms: Date.now() - started, claims: body.claims, log: body.log };
}

// One run = every suite once, for a host, effort and trial. A few runs at a time.
const runs = hosts.flatMap((host) => efforts.flatMap((effort) => [...Array(trials).keys()].map((trial) => ({ host, effort, trial }))));
const results = [];
for (let i = 0; i < runs.length; i += 3) {
  results.push(
    ...(await Promise.all(
      runs.slice(i, i + 3).map(async (r) => {
        const per = await Promise.all(suites.map((s) => check(s, r.host, r.effort, r.trial)));
        const lines = suites.flatMap((s, si) =>
          s.claims.map((c, ci) => {
            const got = per[si].claims[ci];
            return { job: s.job, text: c.text, expect: c.expect, seeded: !!c.seeded, status: got.status, by: got.check?.by, reason: got.reason, ms: got.check?.ms, tokens: got.check?.tokens };
          }),
        );
        process.stderr.write(".");
        return { ...r, lines, failed: per.reduce((n, p) => n + p.log.failed, 0) };
      }),
    )),
  );
}
process.stderr.write("\n");

// Lines the code checks settle are the same at every effort; only the model's lines are scored
// for speed and tokens.
const summary = [];
for (const host of hosts)
  for (const effort of efforts) {
    const rs = results.filter((r) => r.host === host && r.effort === effort);
    const lines = rs.flatMap((r) => r.lines);
    const good = lines.filter((l) => !l.seeded);
    const bad = lines.filter((l) => l.seeded);
    const model = lines.filter((l) => l.by === "verifier" && l.ms);
    const s = {
      host,
      effort,
      trials: rs.length,
      exact: lines.filter((l) => l.status === l.expect).length / lines.length,
      goodPassed: good.filter((l) => l.status === "verified").length / good.length,
      badCaught: bad.filter((l) => l.status === "unsupported" || l.status === "partial").length / bad.length,
      msPerLine: model.reduce((n, l) => n + l.ms, 0) / (model.length || 1),
      outTokensPerLine: model.reduce((n, l) => n + (l.tokens?.completion ?? 0), 0) / (model.length || 1),
      failed: rs.reduce((n, r) => n + r.failed, 0),
    };
    summary.push(s);
    console.log(
      `${host} ${effort.padEnd(7)} ${rs.length} trial(s): ${(100 * s.exact).toFixed(1)}% exact, ` +
        `${(100 * s.goodPassed).toFixed(1)}% good lines passed, ${(100 * s.badCaught).toFixed(1)}% bad lines caught, ` +
        `${(s.msPerLine / 1000).toFixed(1)} s and ${Math.round(s.outTokensPerLine)} output tokens per line` +
        (s.failed ? `, ${s.failed} failed` : ""),
    );
  }

// Lines that came out wrong at least once, with how often per effort.
const keys = [...new Set(results.flatMap((r) => r.lines.map((l) => `${l.job}\t${l.text}`)))];
for (const key of keys) {
  const per = efforts.map((e) => {
    const ls = results.filter((r) => r.effort === e).map((r) => r.lines.find((l) => `${l.job}\t${l.text}` === key));
    return `${e} ${ls.filter((l) => l.status !== l.expect).length}/${ls.length}`;
  });
  const sample = results.flatMap((r) => r.lines).find((l) => `${l.job}\t${l.text}` === key);
  if (results.some((r) => r.lines.some((l) => `${l.job}\t${l.text}` === key && l.status !== l.expect))) {
    console.log(`\n${sample.job}: ${sample.text}\n   expected ${sample.expect}; wrong: ${per.join(", ")}`);
  }
}

if (args.out) {
  await mkdir(path.dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify({ at: new Date().toISOString(), summary, results }, null, 2));
}
