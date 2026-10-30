import "server-only";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { Job } from "./model";
import { isUploadFile, loadUpload } from "./uploads";

export const FIXTURES_DIR = path.join(process.cwd(), "fixtures", "jobs");

// Fixtures ship with the build, so job data is cached and pages that read it prerender.
export async function loadJob(id: string): Promise<Job> {
  "use cache";
  const raw = await readFile(path.join(FIXTURES_DIR, id, "job.json"), "utf8");
  return Job.parse(JSON.parse(raw));
}

export async function listJobIds(): Promise<string[]> {
  "use cache";
  const entries = await readdir(FIXTURES_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

// A file stored with a job fixture (photo or voice recording).
export function jobFilePath(jobId: string, file: string): string {
  return path.join(FIXTURES_DIR, jobId, file);
}

// A photo's bytes: from the job fixture, or a photo the technician added while answering.
export async function photoBytes(jobId: string, file: string): Promise<Buffer> {
  if (!isUploadFile(file)) return readFile(jobFilePath(jobId, file));
  const upload = await loadUpload(file);
  if (!upload) throw new Error(`Photo ${file} is no longer stored`);
  return upload.bytes;
}

export async function photoDataUrl(jobId: string, file: string): Promise<string> {
  const data = await photoBytes(jobId, file);
  return `data:image/jpeg;base64,${data.toString("base64")}`;
}
