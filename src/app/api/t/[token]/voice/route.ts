import { takeVoice } from "@/lib/agent/respond";
import { runIdForToken } from "@/lib/agent/tech-link";
import { loadRun } from "@/lib/agent/runs";
import { cacheCount } from "@/lib/cache";

// A spoken answer, transcribed for the technician's link.
export async function POST(request: Request, ctx: RouteContext<"/api/t/[token]/voice">) {
  const { token } = await ctx.params;
  const runId = await runIdForToken(token);
  const run = runId && (await loadRun(runId));
  if (!run) return Response.json({ error: "This link isn't valid." }, { status: 404 });
  // No passcode here, so cap what one link can transcribe.
  if ((await cacheCount(`tech-voice:${token}`, 3600)) > 30) {
    return Response.json({ error: "Too many recordings from this link; try again later." }, { status: 429 });
  }
  return takeVoice(run, request);
}
