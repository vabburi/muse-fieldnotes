import { z } from "zod";

import { cacheCount } from "@/lib/cache";
import { checkPasscode, isUnlocked, passcodeRequired, unlock } from "@/lib/passcode";

// Whether this browser can run things: { required, unlocked }.
export async function GET() {
  return Response.json({ required: passcodeRequired(), unlocked: await isUnlocked() });
}

const Body = z.object({ passcode: z.string().min(1).max(200) });

// Try the passcode. Ten tries per address per 10 minutes.
export async function POST(request: Request) {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if ((await cacheCount(`unlock:${address}`, 600)) > 10) {
    return Response.json({ error: "Too many tries. Wait 10 minutes." }, { status: 429 });
  }
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success || !checkPasscode(body.data.passcode)) {
    return Response.json({ error: "Wrong passcode." }, { status: 401 });
  }
  await unlock();
  return Response.json({ required: true, unlocked: true });
}
