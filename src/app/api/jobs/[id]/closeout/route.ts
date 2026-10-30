import { cacheGet, cacheSet } from "@/lib/cache";
import { runCloseOut, type CloseOutRun, type Effort } from "@/lib/closeout";
import { listJobIds, loadJob } from "@/lib/fixtures";
import { MetaApiError } from "@/lib/meta";
import { requireUnlocked } from "@/lib/passcode";

const EFFORTS = new Set<Effort>(["low", "medium", "high"]);

async function known(id: string) {
  return (await listJobIds()).includes(id);
}

// The last close-out for this job, if one was generated.
export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]/closeout">) {
  const { id } = await ctx.params;
  if (!(await known(id))) return Response.json({ error: `No job ${id}` }, { status: 404 });
  const run = await cacheGet<CloseOutRun>("closeouts", id);
  return run ? Response.json(run) : Response.json({ error: "No close-out yet" }, { status: 404 });
}

// Generate a new close-out. Optional ?effort=low|medium|high sets the drafter's reasoning effort.
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/closeout">) {
  const locked = await requireUnlocked();
  if (locked) return locked;
  const { id } = await ctx.params;
  if (!(await known(id))) return Response.json({ error: `No job ${id}` }, { status: 404 });
  const effort = new URL(request.url).searchParams.get("effort") as Effort | null;

  try {
    const run = await runCloseOut(await loadJob(id), {
      effort: effort && EFFORTS.has(effort) ? effort : undefined,
    });
    await cacheSet("closeouts", id, run);
    return Response.json(run);
  } catch (error) {
    const status = error instanceof MetaApiError ? 502 : 500;
    return Response.json({ error: (error as Error).message }, { status });
  }
}
