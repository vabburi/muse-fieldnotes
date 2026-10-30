import { MetaApiError } from "@/lib/meta";
import { requireUnlocked } from "@/lib/passcode";
import { segment } from "@/lib/sam";

const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(request: Request) {
  const locked = await requireUnlocked();
  if (locked) return locked;
  const form = await request.formData();
  const image = form.get("image");
  const prompt = String(form.get("prompt") ?? "").trim();

  if (!(image instanceof File) || !prompt) {
    return Response.json({ error: "Send an image file and a prompt." }, { status: 400 });
  }
  if (image.size > MAX_BYTES) {
    return Response.json({ error: "Image is larger than 15 MB." }, { status: 413 });
  }

  const base64 = Buffer.from(await image.arrayBuffer()).toString("base64");
  try {
    const result = await segment(`data:${image.type || "image/jpeg"};base64,${base64}`, prompt);
    return Response.json(result);
  } catch (error) {
    const status = error instanceof MetaApiError ? 502 : 500;
    return Response.json({ error: (error as Error).message }, { status });
  }
}
