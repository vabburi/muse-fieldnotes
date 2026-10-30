import { after } from "next/server";
import { z } from "zod";

import { failRun, review } from "@/lib/agent/loop";
import { loadRun, publicRun, saveRun } from "@/lib/agent/runs";
import { cacheClaim } from "@/lib/cache";
import { loadJob } from "@/lib/fixtures";
import { requireUnlocked } from "@/lib/passcode";

export const maxDuration = 300;

const Body = z.object({ decision: z.enum(["approved", "rejected"]), notes: z.string().max(1000).default("") });

// The office's sign-off. Rejecting needs notes; they go back to the agent.
export async function POST(request: Request, ctx: RouteContext<"/api/runs/[runId]/review">) {
  const locked = await requireUnlocked();
  if (locked) return locked;
  const { runId } = await ctx.params;
  const run = await loadRun(runId);
  if (!run) return Response.json({ error: "No such run" }, { status: 404 });
  if (run.status !== "awaiting_signoff" && run.status !== "escalated") {
    return Response.json({ error: `Run is ${run.status}` }, { status: 409 });
  }
  const body = Body.safeParse(await request.json());
  if (!body.success) return Response.json({ error: z.prettifyError(body.error) }, { status: 400 });
  const { decision, notes } = body.data;
  if (decision === "rejected" && !notes.trim()) return Response.json({ error: "Say what to fix" }, { status: 400 });

  if (!(await cacheClaim(`run:${run.id}:${run.steps.length}`))) {
    return Response.json({ error: "Already sent" }, { status: 409 });
  }
  const job = await loadJob(run.jobId);
  if (decision === "approved") return Response.json(publicRun(await review(job, run, decision, notes)));
  run.status = "running";
  await saveRun(run);
  after(() => review(job, run, decision, notes).catch((error) => failRun(run.id, error)));
  return Response.json(publicRun(run), { status: 202 });
}
