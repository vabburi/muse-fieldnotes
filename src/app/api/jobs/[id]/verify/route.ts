import { z } from "zod";

import { cacheGet } from "@/lib/cache";
import type { CloseOutRun } from "@/lib/closeout";
import { listJobIds, loadJob } from "@/lib/fixtures";
import { ground } from "@/lib/grounding";
import { Citation, Section, Source } from "@/lib/model";
import { requireUnlocked } from "@/lib/passcode";
import { ProviderApiError } from "@/lib/spark-open";
import { verifyClaims } from "@/lib/verifier";

const Body = z.object({
  claims: z.array(z.object({ section: Section, text: z.string().min(1), citations: z.array(Citation).min(1) })).min(1),
  // Pin one host instead of the failover chain, to compare hosts.
  provider: z.enum(["baseten", "fireworks", "modal"]).optional(),
  // Evals: the reasoning effort to check at (the app uses low) and which repeat this is.
  effort: z.enum(["minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
  trial: z.number().int().min(0).max(20).optional(),
  // Evals: derived sources (nameplate readings) to check against, instead of the last note's.
  derived: z.array(Source).optional(),
});

// Runs the code checks and the verifier on lines you send, against this job's sources (plus the
// nameplate readings sent, or else those from its last close-out). For evals with seeded bad lines, and for checking
// a hand-edited line.
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/verify">) {
  const { id } = await ctx.params;
  if (!(await listJobIds()).includes(id)) return Response.json({ error: `No job ${id}` }, { status: 404 });
  const locked = await requireUnlocked();
  if (locked) return locked;
  const body = Body.safeParse(await request.json());
  if (!body.success) return Response.json({ error: z.prettifyError(body.error) }, { status: 400 });

  const job = await loadJob(id);
  const derived = body.data.derived ?? (await cacheGet<CloseOutRun>("closeouts", id))?.derived ?? [];
  const sources = [...job.sources, ...derived];
  const byId = new Map(sources.map((s) => [s.id, s]));
  const grounded = body.data.claims.map((c, i) => ground({ ...c, id: `t${i + 1}`, status: "draft" }, byId));

  try {
    return Response.json(await verifyClaims(job, grounded, sources, {
        only: body.data.provider,
        effort: body.data.effort,
        trial: body.data.trial,
      }));
  } catch (error) {
    const status = error instanceof ProviderApiError ? 502 : 500;
    return Response.json({ error: (error as Error).message }, { status });
  }
}
