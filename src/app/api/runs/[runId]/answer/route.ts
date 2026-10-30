import { after } from "next/server";
import { z } from "zod";

import { answer, failRun } from "@/lib/agent/loop";
import { loadRun, publicRun, saveRun } from "@/lib/agent/runs";
import { cacheClaim } from "@/lib/cache";
import { loadJob } from "@/lib/fixtures";
import { requireUnlocked } from "@/lib/passcode";
import { loadUpload, type Upload } from "@/lib/uploads";

export const maxDuration = 300;

const Body = z.object({
  answers: z
    .array(z.object({ id: z.string(), answer: z.string().max(500), photos: z.array(z.string()).max(3).default([]) }))
    .min(1),
});

// The technician's answers to the agent's questions: text, photos (uploaded first, by file
// name), or both; an empty answer means "don't know".
export async function POST(request: Request, ctx: RouteContext<"/api/runs/[runId]/answer">) {
  const locked = await requireUnlocked();
  if (locked) return locked;
  const { runId } = await ctx.params;
  const run = await loadRun(runId);
  if (!run) return Response.json({ error: "No such run" }, { status: 404 });
  if (run.status !== "needs_input") return Response.json({ error: `Run is ${run.status}` }, { status: 409 });
  const body = Body.safeParse(await request.json());
  if (!body.success) return Response.json({ error: z.prettifyError(body.error) }, { status: 400 });
  const answers: { id: string; answer: string; photos: Upload[] }[] = [];
  for (const a of body.data.answers) {
    const photos = await Promise.all(a.photos.map(loadUpload));
    if (photos.some((p) => !p)) return Response.json({ error: "A photo didn't upload; add it again." }, { status: 400 });
    answers.push({ ...a, photos: photos.map((p) => ({ file: p!.file, width: p!.width, height: p!.height })) });
  }

  if (!(await cacheClaim(`run:${run.id}:${run.steps.length}`))) {
    return Response.json({ error: "Already sent" }, { status: 409 });
  }
  run.status = "running";
  await saveRun(run);
  const job = await loadJob(run.jobId);
  after(() => answer(job, run, answers).catch((error) => failRun(run.id, error)));
  return Response.json(publicRun(run), { status: 202 });
}
