import { runIdForToken } from "@/lib/agent/tech-link";
import { loadRun } from "@/lib/agent/runs";
import { loadJob } from "@/lib/fixtures";

// What the technician's page needs: the job's name and the open questions, nothing else.
export async function GET(_request: Request, ctx: RouteContext<"/api/t/[token]">) {
  const { token } = await ctx.params;
  const runId = await runIdForToken(token);
  const run = runId && (await loadRun(runId));
  if (!run) return Response.json({ error: "This link isn't valid." }, { status: 404 });
  const job = await loadJob(run.jobId);
  return Response.json({
    job: { id: job.id, title: job.title },
    status: run.status,
    questions: run.status === "needs_input" ? run.questions.filter((q) => q.answer === undefined) : [],
  });
}
