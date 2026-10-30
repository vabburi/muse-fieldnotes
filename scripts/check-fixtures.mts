// Validate every fixture job: schema, photo files and sizes, and no EXIF left in photos
// (EXIF can carry GPS location). Usage: npm run check:fixtures
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { Job } from "../src/lib/model.ts";

const dir = path.join(import.meta.dirname, "..", "fixtures", "jobs");
const ids = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
let failures = 0;

for (const id of ids.sort()) {
  const problems: string[] = [];
  const parsed = Job.safeParse(JSON.parse(await readFile(path.join(dir, id, "job.json"), "utf8")));

  if (!parsed.success) {
    problems.push(...parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  } else {
    if (parsed.data.id !== id) problems.push(`id ${parsed.data.id} does not match folder ${id}`);
    for (const source of parsed.data.sources) {
      if (source.kind !== "photo") continue;
      try {
        const meta = await sharp(path.join(dir, id, source.photo.file)).metadata();
        if (meta.width !== source.photo.width || meta.height !== source.photo.height) {
          problems.push(`${source.id}: ${source.photo.file} is ${meta.width}x${meta.height}, job says ${source.photo.width}x${source.photo.height}`);
        }
        if (meta.exif) problems.push(`${source.id}: ${source.photo.file} still has EXIF; run scripts/prepare-photo.mjs`);
      } catch {
        problems.push(`${source.id}: cannot read ${source.photo.file}`);
      }
    }
  }

  if (problems.length) {
    failures++;
    console.log(`✗ ${id}\n  ${problems.join("\n  ")}`);
  } else {
    console.log(`✓ ${id} (${parsed.data!.sources.length} sources)`);
  }
}

process.exit(failures ? 1 : 0);
