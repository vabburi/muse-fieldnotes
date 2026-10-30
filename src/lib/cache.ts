import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { Redis } from "@upstash/redis";

// Small JSON store for slow model results (nameplate readings, SAM masks, verdicts) and for
// state that has to outlive a request (agent runs, the last close-out per job).
// Deployed, it lives in Upstash Redis, so every server instance sees the same runs: a run's
// turns are saved by one instance while the page polls, and answers arrive, on others.
// Locally it is files under .cache/, never the deployed database (even though its vars are
// in .env.local), so local test runs can't replace the notes judges see.
// Best effort: a read or write failure just means a cache miss.

const env = process.env;
const deployed = env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview";
const REDIS_URL = deployed ? (env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL) : undefined;
const REDIS_TOKEN = deployed ? (env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN) : undefined;
const redis = REDIS_URL && REDIS_TOKEN ? new Redis({ url: REDIS_URL, token: REDIS_TOKEN }) : null;

// Keep everything for 30 days; the demo jobs are re-run well within that.
const TTL_SECONDS = 30 * 24 * 3600;
const PREFIX = "fieldnotes";
const ROOT = path.join(process.cwd(), ".cache");

if (!redis && deployed) {
  console.warn("cache: no Upstash Redis configured; runs will not survive across server instances");
}

export function cacheBackend(): "redis" | "files" {
  return redis ? "redis" : "files";
}

export function hashKey(...parts: (string | Buffer)[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex").slice(0, 32);
}

function file(bucket: string, key: string) {
  return path.join(ROOT, bucket, `${key}.json`);
}

export async function cacheGet<T>(bucket: string, key: string): Promise<T | undefined> {
  try {
    if (redis) return (await redis.get<T>(`${PREFIX}:${bucket}:${key}`)) ?? undefined;
    return JSON.parse(await readFile(file(bucket, key), "utf8")) as T;
  } catch {
    return undefined;
  }
}

export async function cacheSet(bucket: string, key: string, value: unknown): Promise<void> {
  try {
    if (redis) {
      await redis.set(`${PREFIX}:${bucket}:${key}`, value, { ex: TTL_SECONDS });
      return;
    }
    await mkdir(path.join(ROOT, bucket), { recursive: true });
    // Write then rename, so a reader never sees a half-written file.
    const target = file(bucket, key);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(value));
    await rename(tmp, target);
  } catch (error) {
    // Read-only filesystem, full disk or Redis down: carry on without caching.
    if (redis) console.warn(`cache: set ${bucket}:${key} failed: ${(error as Error).message}`);
  }
}

const claimed = new Set<string>();

// Claim a one-time action (e.g. "answer run abc at step 7"), so two clicks or two server
// instances can't both act on the same state. True for the first caller only.
export async function cacheClaim(key: string, seconds = 600): Promise<boolean> {
  if (redis) return (await redis.set(`${PREFIX}:claim:${key}`, 1, { nx: true, ex: seconds })) === "OK";
  if (claimed.has(key)) return false;
  claimed.add(key);
  return true;
}

const counts = new Map<string, { n: number; until: number }>();

// Count an event in a time window (e.g. passcode attempts per address); returns the count so far.
export async function cacheCount(key: string, seconds: number): Promise<number> {
  if (redis) {
    const k = `${PREFIX}:count:${key}`;
    const n = await redis.incr(k);
    if (n === 1) await redis.expire(k, seconds);
    return n;
  }
  const now = Date.now();
  const entry = counts.get(key);
  const next = entry && entry.until > now ? { ...entry, n: entry.n + 1 } : { n: 1, until: now + seconds * 1000 };
  counts.set(key, next);
  return next.n;
}
