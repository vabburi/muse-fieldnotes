import { takeAnswers } from "@/lib/agent/respond";
import { runIdForToken } from "@/lib/agent/tech-link";
import { loadRun } from "@/lib/agent/runs";

export const maxDuration = 300;

// The technician's answers, sent from their link.
export async function POST(request: Request, ctx: RouteContext<"/api/t/[token]/answer">) {
  const { token } = await ctx.params;
  const runId = await runIdForToken(token);
  const run = runId && (await loadRun(runId));
  if (!run) return Response.json({ error: "This link isn't valid." }, { status: 404 });
  const res = await takeAnswers(run, request);
  // The technician's page needs only that it worked, not the run.
  return res.ok ? Response.json({ sent: true }, { status: 202 }) : res;
}
