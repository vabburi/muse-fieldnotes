import { takePhoto } from "@/lib/agent/respond";
import { loadRun } from "@/lib/agent/runs";
import { requireUnlocked } from "@/lib/passcode";

// A photo for an answer, added from the office page.
export async function POST(request: Request, ctx: RouteContext<"/api/runs/[runId]/photos">) {
  const locked = await requireUnlocked();
  if (locked) return locked;
  const { runId } = await ctx.params;
  const run = await loadRun(runId);
  if (!run) return Response.json({ error: "No such run" }, { status: 404 });
  return takePhoto(run, request);
}
