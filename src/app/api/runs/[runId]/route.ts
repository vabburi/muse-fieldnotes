import { loadRun, publicRun } from "@/lib/agent/runs";

export async function GET(_request: Request, ctx: RouteContext<"/api/runs/[runId]">) {
  const { runId } = await ctx.params;
  const run = await loadRun(runId);
  return run ? Response.json(publicRun(run)) : Response.json({ error: "No such run" }, { status: 404 });
}
