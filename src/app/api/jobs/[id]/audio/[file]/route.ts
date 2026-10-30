import { readFile } from "node:fs/promises";

import { jobFilePath, listJobIds, loadJob } from "@/lib/fixtures";

// Serves a voice note's recording. Only files the job lists as voice audio can be fetched.
export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]/audio/[file]">) {
  const { id, file } = await ctx.params;
  if (!(await listJobIds()).includes(id)) return new Response("Not found", { status: 404 });

  const job = await loadJob(id);
  const listed = job.sources.some((s) => s.kind === "voice" && s.audio?.file === file);
  if (!listed) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(await readFile(jobFilePath(id, file))), {
    headers: { "Content-Type": "audio/mp4", "Cache-Control": "public, max-age=3600" },
  });
}
