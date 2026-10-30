import "server-only";

import sharp from "sharp";

import { cacheGet, cacheSet, hashKey } from "./cache";

// Photos the technician takes while answering the agent's questions. They are stored with the
// other run state (Redis deployed, .cache/ locally) and named by their content.

const MAX_SIDE = 1600;
const FILE = /^upload-([0-9a-f]{32})\.jpg$/;

export interface Upload {
  file: string;
  width: number;
  height: number;
}

export function isUploadFile(file: string): boolean {
  return FILE.test(file);
}

// Re-encodes the photo: turned upright, at most 1600 px a side, and without EXIF (sharp drops
// metadata unless asked to keep it), so no location or device data is stored.
export async function saveUpload(input: Buffer): Promise<Upload> {
  const { data, info } = await sharp(input)
    .rotate()
    .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  const key = hashKey(data);
  const upload = { file: `upload-${key}.jpg`, width: info.width, height: info.height };
  await cacheSet("uploads", key, { ...upload, data: data.toString("base64") });
  return upload;
}

export async function loadUpload(file: string): Promise<(Upload & { bytes: Buffer }) | undefined> {
  const key = FILE.exec(file)?.[1];
  if (!key) return undefined;
  const stored = await cacheGet<Upload & { data: string }>("uploads", key);
  if (!stored) return undefined;
  return { file: stored.file, width: stored.width, height: stored.height, bytes: Buffer.from(stored.data, "base64") };
}
