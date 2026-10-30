import "server-only";

import { after } from "next/server";
import { z } from "zod";

import { cacheClaim } from "../cache";
import { loadJob } from "../fixtures";
import { loadUpload, saveUpload, type Upload } from "../uploads";
import { answer, failRun } from "./loop";
import { publicRun, saveRun, type AgentRun } from "./runs";

// The technician's side of a run, shared by the office page (passcode) and the technician's
// link (its token): add a photo, then send the answers.

// Phones resize before sending; this is the platform's request limit with some room.
const MAX_PHOTO_BYTES = 4_000_000;

const Body = z.object({
  answers: z
    .array(z.object({ id: z.string(), answer: z.string().max(500), photos: z.array(z.string()).max(3).default([]) }))
    .min(1),
});

// A photo taken to answer a question (the body is the image). It becomes a source only when
// the answers are sent.
export async function takePhoto(run: AgentRun, request: Request): Promise<Response> {
  if (run.status !== "needs_input") return Response.json({ error: `Run is ${run.status}` }, { status: 409 });
  if (!request.headers.get("content-type")?.startsWith("image/")) {
    return Response.json({ error: "Send the photo as the request body." }, { status: 415 });
  }
  const body = Buffer.from(await request.arrayBuffer());
  if (body.length === 0 || body.length > MAX_PHOTO_BYTES) {
    return Response.json({ error: "Photo is empty or too large." }, { status: 413 });
  }
  try {
    return Response.json(await saveUpload(body));
  } catch {
    return Response.json({ error: "Could not read that photo." }, { status: 400 });
  }
}

// The answers: text, photos (uploaded first, by file name), or both; an empty answer means
// "don't know". The agent continues after the response is sent.
export async function takeAnswers(run: AgentRun, request: Request): Promise<Response> {
  if (run.status !== "needs_input") return Response.json({ error: `Run is ${run.status}` }, { status: 409 });
  const body = Body.safeParse(await request.json());
  if (!body.success) return Response.json({ error: z.prettifyError(body.error) }, { status: 400 });
  const answers: { id: string; answer: string; photos: Upload[] }[] = [];
  for (const a of body.data.answers) {
    const photos = await Promise.all(a.photos.map(loadUpload));
    if (photos.some((p) => !p)) return Response.json({ error: "A photo didn't upload; add it again." }, { status: 400 });
    answers.push({ ...a, photos: photos.map((p) => ({ file: p!.file, width: p!.width, height: p!.height })) });
  }

  // The office and the technician can both answer; only the first to send counts.
  if (!(await cacheClaim(`run:${run.id}:${run.steps.length}`))) {
    return Response.json({ error: "Already sent" }, { status: 409 });
  }
  run.status = "running";
  await saveRun(run);
  const job = await loadJob(run.jobId);
  after(() => answer(job, run, answers).catch((error) => failRun(run.id, error)));
  return Response.json(publicRun(run), { status: 202 });
}
