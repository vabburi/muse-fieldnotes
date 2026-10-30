import "server-only";

import { randomBytes } from "node:crypto";

import { cacheGet, cacheSet } from "../cache";

// The link the technician opens on their phone to answer a run's questions. The token is the
// only credential (no passcode on a phone in a driveway), so it is random, and it only works
// while that run is waiting for answers.

const TOKEN = /^[A-Za-z0-9_-]{22}$/;

export async function techToken(runId: string): Promise<string> {
  const existing = await cacheGet<string>("tech-link-of", runId);
  if (existing) return existing;
  // Two office tabs asking at once may each make one; both stay valid for the run.
  const token = randomBytes(16).toString("base64url");
  await cacheSet("tech-links", token, runId);
  await cacheSet("tech-link-of", runId, token);
  return token;
}

export async function runIdForToken(token: string): Promise<string | undefined> {
  if (!TOKEN.test(token)) return undefined;
  return cacheGet<string>("tech-links", token);
}
