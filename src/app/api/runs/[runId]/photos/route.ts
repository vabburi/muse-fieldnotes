import { loadRun } from "@/lib/agent/runs";
import { requireUnlocked } from "@/lib/passcode";
import { saveUpload } from "@/lib/uploads";

// Phones resize before sending; this is the platform's request limit with some room.
const MAX_BYTES = 4_000_000;

// A photo the technician takes to answer one of the agent's questions (the body is the image).
// It becomes a source only when the answers are sent.
export async function POST(request: Request, ctx: RouteContext<"/api/runs/[runId]/photos">) {
  const locked = await requireUnlocked();
  if (locked) return locked;
  const { runId } = await ctx.params;
  const run = await loadRun(runId);
  if (!run) return Response.json({ error: "No such run" }, { status: 404 });
  if (run.status !== "needs_input") return Response.json({ error: `Run is ${run.status}` }, { status: 409 });
  if (!request.headers.get("content-type")?.startsWith("image/")) {
    return Response.json({ error: "Send the photo as the request body." }, { status: 415 });
  }
  const body = Buffer.from(await request.arrayBuffer());
  if (body.length === 0 || body.length > MAX_BYTES) return Response.json({ error: "Photo is empty or too large." }, { status: 413 });
  try {
    return Response.json(await saveUpload(body));
  } catch {
    return Response.json({ error: "Could not read that photo." }, { status: 400 });
  }
}
