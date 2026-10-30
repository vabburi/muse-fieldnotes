import QRCode from "qrcode";

import { loadRun } from "@/lib/agent/runs";
import { techToken } from "@/lib/agent/tech-link";
import { requireUnlocked } from "@/lib/passcode";

// The technician's link for a run waiting on answers, with a QR code to scan. Only for the
// office (passcode): the link itself lets anyone holding it answer.
export async function GET(request: Request, ctx: RouteContext<"/api/runs/[runId]/tech-link">) {
  const locked = await requireUnlocked();
  if (locked) return locked;
  const { runId } = await ctx.params;
  const run = await loadRun(runId);
  if (!run) return Response.json({ error: "No such run" }, { status: 404 });
  if (run.status !== "needs_input") return Response.json({ error: `Run is ${run.status}` }, { status: 409 });

  // The address the office is using, so a phone on the same network can reach it.
  const url = new URL(`/t/${await techToken(run.id)}`, new URL(request.url).origin).toString();
  const qr = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return Response.json({ url, qr });
}
