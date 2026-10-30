import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

// One shared passcode for the demo: anyone can read the jobs and notes, but anything that
// spends model credits (running the agent, answering, signing off, re-checking a line,
// computing a new highlight) needs it. Set DEMO_PASSCODE to turn it on; deployed without one,
// those actions are refused rather than left open.

const COOKIE = "fieldnotes_unlock";

function passcode(): string | undefined {
  return process.env.DEMO_PASSCODE || undefined;
}

export function passcodeRequired(): boolean {
  return Boolean(passcode() || process.env.VERCEL);
}

// The cookie holds a keyed hash of the passcode, never the passcode itself.
function token(code: string): string {
  return createHmac("sha256", code).update("fieldnotes-unlock").digest("hex");
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkPasscode(attempt: string): boolean {
  const code = passcode();
  return Boolean(code) && same(token(attempt), token(code!));
}

export async function unlock(): Promise<void> {
  (await cookies()).set(COOKIE, token(passcode()!), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 14 * 24 * 3600,
  });
}

export async function isUnlocked(): Promise<boolean> {
  if (!passcodeRequired()) return true;
  const code = passcode();
  if (!code) return false;
  const cookie = (await cookies()).get(COOKIE)?.value;
  return Boolean(cookie) && same(cookie!, token(code));
}

// For routes that spend credits: a 401 the page turns into the passcode prompt.
export async function requireUnlocked(): Promise<Response | null> {
  if (await isUnlocked()) return null;
  return Response.json({ error: "Enter the demo passcode at the top of the page.", locked: true }, { status: 401 });
}
