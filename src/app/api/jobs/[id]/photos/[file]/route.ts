import { readFile } from "node:fs/promises";

import { jobFilePath, listJobIds, loadJob } from "@/lib/fixtures";
import { isUploadFile, loadUpload } from "@/lib/uploads";

// Serves a job's photo. Only files the job lists as photo sources can be fetched, and photos the
// technician took while answering (named by their content, so the name can't be guessed).
export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]/photos/[file]">) {
  const { id, file } = await ctx.params;
  if (!(await listJobIds()).includes(id)) return new Response("Not found", { status: 404 });
  if (isUploadFile(file)) {
    const upload = await loadUpload(file);
    if (!upload) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(upload.bytes), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" },
    });
  }

  const job = await loadJob(id);
  const listed = job.sources.some((s) => s.kind === "photo" && s.photo.file === file);
  if (!listed) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(await readFile(jobFilePath(id, file))), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" },
  });
}
