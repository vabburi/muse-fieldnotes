import { cacheGet, cacheSet, hashKey } from "@/lib/cache";
import { listJobIds, loadJob, photoBytes } from "@/lib/fixtures";
import { MetaApiError } from "@/lib/meta";
import { Box, type Box as BoxType } from "@/lib/model";
import { requireUnlocked } from "@/lib/passcode";
import { segment, type Segmentation } from "@/lib/sam";
import { loadUpload } from "@/lib/uploads";

// SAM 3.1 highlight for one cited photo: { source: "S2", box?: {...}, phrase?: "metal box" }.
// A photo the technician took while answering isn't in the job, so it comes as { file }.
// The box (from the drafter) is tried first; the phrase is the fallback.
// Cached by photo content and target, so reopening a citation is instant.
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/highlight">) {
  const { id } = await ctx.params;
  if (!(await listJobIds()).includes(id)) return Response.json({ error: `No job ${id}` }, { status: 404 });

  const body = (await request.json()) as { source?: string; file?: string; phrase?: string; box?: unknown };
  const job = await loadJob(id);
  const source = job.sources.find((s) => s.id === body.source);
  const photo = source?.kind === "photo" ? source.photo : body.file ? await loadUpload(body.file) : undefined;
  const box = Box.safeParse(body.box);
  const phrase = body.phrase?.trim();
  if (!photo || (!box.success && !phrase)) {
    return Response.json({ error: "Send a photo source id and a box or phrase." }, { status: 400 });
  }

  const image = await photoBytes(id, photo.file);
  const key = hashKey("sam-3.1", JSON.stringify(box.data ?? null), phrase ?? "", image);
  const cached = await cacheGet<Segmentation>("highlights", key);
  if (cached) return Response.json({ ...cached, cached: true });
  // Highlights already computed are free to view; a new one runs SAM, so it needs the passcode.
  const locked = await requireUnlocked();
  if (locked) return locked;

  const url = `data:image/jpeg;base64,${image.toString("base64")}`;
  const size = { width: photo.width, height: photo.height };
  try {
    // Run both prompts at once. A phrase gives clean whole-object masks but may match several
    // objects (or none); the drafter's box says which one is meant but is often loose.
    const [byBox, byPhrase] = await Promise.all([
      box.success ? segment(url, { box: box.data, size }) : null,
      phrase ? segment(url, phrase) : null,
    ]);
    const result = pick(byBox, byPhrase, box.success ? box.data : undefined);
    await cacheSet("highlights", key, result);
    return Response.json(result);
  } catch (error) {
    const status = error instanceof MetaApiError ? 502 : 500;
    return Response.json({ error: (error as Error).message }, { status });
  }
}

function area(r: BoxType): number {
  return Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
}

function intersection(a: BoxType, b: BoxType): BoxType {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
}

function union(boxes: BoxType[]): BoxType {
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    top: Math.min(...boxes.map((b) => b.top)),
    right: Math.max(...boxes.map((b) => b.right)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
}

function iou(a: BoxType, b: BoxType): number {
  const overlap = area(intersection(a, b));
  return overlap / (area(a) + area(b) - overlap || 1);
}

// Prefer the phrase matches that sit inside the drafter's box (one equipment unit can come back
// as several pieces) when together they fill it; otherwise use the box prompt's mask.
function pick(byBox: Segmentation | null, byPhrase: Segmentation | null, box?: BoxType): Segmentation {
  if (byPhrase?.objects.length && box) {
    const inside = byPhrase.objects.filter((o) => area(intersection(o.box, box)) >= 0.7 * area(o.box));
    if (inside.length && iou(union(inside.map((o) => o.box)), box) >= 0.5) return { ...byPhrase, objects: inside };
  }
  if (byBox?.objects.length) return byBox;
  return byPhrase ?? byBox!;
}
