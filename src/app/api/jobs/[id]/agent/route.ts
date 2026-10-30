import { after } from "next/server";

import { failRun, MAX_TURNS, start } from "@/lib/agent/loop";
import { latestRunId, loadRun, newRun, publicRun, saveRun } from "@/lib/agent/runs";
import { listJobIds, loadJob } from "@/lib/fixtures";
import { requireUnlocked } from "@/lib/passcode";

export const maxDuration = 300;

// The job's latest close-out agent run.
export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]/agent">) {
  const { id } = await ctx.params;
  if (!(await listJobIds()).includes(id)) return Response.json({ error: `No job ${id}` }, { status: 404 });
  const runId = await latestRunId(id);
  const run = runId && (await loadRun(runId));
  return run ? Response.json(publicRun(run)) : Response.json({ error: "No run yet" }, { status: 404 });
}

// Start a new run. It works in the background; the page polls /api/runs/{id}.
export async function POST(_request: Request, ctx: RouteContext<"/api/jobs/[id]/agent">) {
  const locked = await requireUnlocked();
  if (locked) return locked;
  const { id } = await ctx.params;
  if (!(await listJobIds()).includes(id)) return Response.json({ error: `No job ${id}` }, { status: 404 });
  const job = await loadJob(id);
  const run = newRun(id, MAX_TURNS);
  await saveRun(run);
  after(() => start(job, run).catch((error) => failRun(run.id, error)));
  return Response.json(publicRun(run), { status: 202 });
}
