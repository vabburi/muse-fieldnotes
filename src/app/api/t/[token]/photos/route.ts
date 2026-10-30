import { takePhoto } from "@/lib/agent/respond";
import { runIdForToken } from "@/lib/agent/tech-link";
import { loadRun } from "@/lib/agent/runs";
import { cacheCount } from "@/lib/cache";

// A photo for an answer, added from the technician's link.
export async function POST(request: Request, ctx: RouteContext<"/api/t/[token]/photos">) {
  const { token } = await ctx.params;
  const runId = await runIdForToken(token);
  const run = runId && (await loadRun(runId));
  if (!run) return Response.json({ error: "This link isn't valid." }, { status: 404 });
  // No passcode here, so cap what one link can store.
  if ((await cacheCount(`tech-photos:${token}`, 3600)) > 30) {
    return Response.json({ error: "Too many photos from this link; try again later." }, { status: 429 });
  }
  return takePhoto(run, request);
}
