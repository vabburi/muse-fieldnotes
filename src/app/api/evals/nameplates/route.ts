import { z } from "zod";

import { readNameplate } from "@/lib/closeout";
import { listJobIds, loadJob } from "@/lib/fixtures";
import { MetaApiError } from "@/lib/meta";
import { requireUnlocked } from "@/lib/passcode";

export const maxDuration = 300;

const Body = z.object({
  job: z.string(),
  source: z.string(),
  effort: z.enum(["minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
  trial: z.number().int().min(0).max(20).optional(),
});

// Evals: read one fixture photo's rating plate at a given reasoning effort
// (scripts/eval-nameplates.mjs compares the fields with evals/nameplates.json).
export async function POST(request: Request) {
  const locked = await requireUnlocked();
  if (locked) return locked;
  const body = Body.safeParse(await request.json());
  if (!body.success) return Response.json({ error: z.prettifyError(body.error) }, { status: 400 });
  const { job: jobId, source, effort, trial } = body.data;
  if (!(await listJobIds()).includes(jobId)) return Response.json({ error: `No job ${jobId}` }, { status: 404 });
  const job = await loadJob(jobId);
  const photo = job.sources.find((s) => s.id === source);
  if (photo?.kind !== "photo") return Response.json({ error: `${source} is not a photo` }, { status: 400 });

  try {
    const reading = await readNameplate(job, photo, "S0", { effort, trial });
    return Response.json({ fields: reading.source?.kind === "nameplate" ? reading.source.fields : null, ms: reading.ms });
  } catch (error) {
    const status = error instanceof MetaApiError ? 502 : 500;
    return Response.json({ error: (error as Error).message }, { status });
  }
}
