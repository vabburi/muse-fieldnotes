import "server-only";

import {
  buildObjectPrompt,
  decodeMaskToSVGPath,
  parseImageStream,
  recordsOfKind,
  type ResponsesEvent,
} from "@meta-sam/parser";

import { metaPost } from "./meta";
import type { Box } from "./model";

export interface SegmentedObject {
  id: string;
  box: { left: number; top: number; right: number; bottom: number };
  confidence?: number;
  // SVG path in mask-raster coordinates; `transform` places it in image pixels.
  path: string;
  transform: string;
}

export interface Segmentation {
  prompt: string;
  width: number;
  height: number;
  objects: SegmentedObject[];
  ms: number;
}

interface ResponsesBody {
  output: { type: string; content?: { type: string; text?: string }[] }[];
}

// Image size as SAM reports it on every box token (w=…;h=…).
const SIZE_RE = /;w=(\d+);h=(\d+)\|>/;

// We call SAM without streaming, then replay the finished text through the parser
// so we get Meta's own mask decoder without managing an SSE connection.
async function* replay(text: string): AsyncIterable<ResponsesEvent> {
  yield { type: "response.output_text.done", item_id: "sam", output_index: 0, content_index: 0, text };
  yield { type: "response.completed" };
}

// What to segment: a short noun phrase, or a box around one object (an object prompt).
// A box is far more reliable for specific equipment; phrases only match generic shapes.
export type SegmentTarget = string | { box: Box; size: { width: number; height: number } };

function clampBox(box: Box, size: { width: number; height: number }): Box {
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)));
  const left = clamp(box.left, size.width - 1);
  const top = clamp(box.top, size.height - 1);
  return {
    left,
    top,
    right: Math.max(left + 1, clamp(box.right, size.width)),
    bottom: Math.max(top + 1, clamp(box.bottom, size.height)),
  };
}

export async function segment(imageDataUrl: string, target: SegmentTarget): Promise<Segmentation> {
  const started = Date.now();
  const prompt =
    typeof target === "string"
      ? target
      : buildObjectPrompt({ size: target.size, objects: [{ id: 0, prompts: [{ box: clampBox(target.box, target.size) }] }] });
  const response = await metaPost<ResponsesBody>("/responses", {
    model: "sam-3.1",
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: imageDataUrl },
        ],
      },
    ],
  });

  const text =
    response.output
      .flatMap((item) => item.content ?? [])
      .find((part) => part.type === "output_text")?.text ?? "";

  const result = await parseImageStream(replay(text)).finalResult;
  const confidences = new Map(
    recordsOfKind(result.records, "box").map((box) => [box.objectId, box.confidence]),
  );

  const objects = recordsOfKind(result.records, "mask").map((record) => {
    const { bounds, mask } = record;
    const sx = (bounds.right - bounds.left) / mask.width;
    const sy = (bounds.bottom - bounds.top) / mask.height;
    return {
      id: record.objectId,
      box: bounds,
      confidence: record.confidence ?? confidences.get(record.objectId),
      path: decodeMaskToSVGPath(mask),
      transform: `translate(${bounds.left} ${bounds.top}) scale(${sx} ${sy})`,
    };
  });

  const size = text.match(SIZE_RE);
  return {
    prompt,
    width: size ? Number(size[1]) : 0,
    height: size ? Number(size[2]) : 0,
    objects,
    ms: Date.now() - started,
  };
}
