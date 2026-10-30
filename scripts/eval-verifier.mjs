// Runs the seeded eval lines through the verify route on each host and prints how many verdicts
// match the expected status, plus where the hosts disagree. Needs the dev server running.
// Usage: node scripts/eval-verifier.mjs [evals/job-001.lines.json] [baseten,fireworks,modal]
import { readFile } from "node:fs/promises";

const file = process.argv[2] ?? "evals/job-001.lines.json";
const hosts = (process.argv[3] ?? "baseten,fireworks,modal").split(",");
const APP = process.env.APP_URL ?? "http://localhost:3000";

const suite = JSON.parse(await readFile(file, "utf8"));
const claims = suite.claims.map(({ section, text, citations }) => ({ section, text, citations }));

const results = await Promise.all(
  hosts.map(async (provider) => {
    const started = Date.now();
    const res = await fetch(`${APP}/api/jobs/${suite.job}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claims, provider }),
    });
    const body = await res.json();
    if (!res.ok) return { provider, error: body.error };
    // No line could be checked: the host isn't configured or is down.
    if (body.log.calls === 0 && body.log.failed > 0) {
      return { provider, error: body.claims.find((c) => c.status === "unverified").reason };
    }
    return { provider, ms: Date.now() - started, claims: body.claims, log: body.log };
  }),
);

for (const r of results) {
  if (r.error) {
    console.log(`${r.provider}: ${r.error}`);
    continue;
  }
  const right = r.claims.filter((c, i) => c.status === suite.claims[i].expect).length;
  const caught = suite.claims.filter((c, i) => c.seeded && r.claims[i].status === c.expect).length;
  const seeded = suite.claims.filter((c) => c.seeded).length;
  console.log(
    `${r.provider}: ${right}/${claims.length} as expected, ${caught}/${seeded} seeded bad lines caught,` +
      ` ${(r.ms / 1000).toFixed(1)} s, ${r.log.tokens.prompt} in / ${r.log.tokens.completion} out tokens` +
      ` (${r.log.cached} cached, ${r.log.failed} failed)`,
  );
}

const ok = results.filter((r) => !r.error);
suite.claims.forEach((c, i) => {
  const statuses = ok.map((r) => r.claims[i].status);
  if (statuses.some((s) => s !== c.expect)) {
    console.log(`\n${i + 1}. ${c.text}\n   expected ${c.expect}; ${ok.map((r) => `${r.provider} ${r.claims[i].status}`).join(", ")}`);
    for (const r of ok) if (r.claims[i].status !== c.expect) console.log(`   ${r.provider}: ${r.claims[i].reason}`);
  }
});
