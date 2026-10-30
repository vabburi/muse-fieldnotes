// Smoke test for SAM 3.1 on the Meta Model API: segment one noun phrase in one image.
// Usage: node --env-file=.env scripts/sam.mjs path/to/image.jpg "noun phrase"
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const BASE_URL = process.env.MODEL_API_BASE_URL ?? "https://api.meta.ai/v1";
const API_KEY = process.env.MODEL_API_KEY;
const [imagePath, prompt = "air handler"] = process.argv.slice(2);

if (!API_KEY || !imagePath) {
  console.error('Usage: node --env-file=.env scripts/sam.mjs path/to/image.jpg "noun phrase"');
  process.exit(1);
}

const mime = { ".png": "image/png", ".webp": "image/webp" }[extname(imagePath).toLowerCase()] ?? "image/jpeg";
const data = (await readFile(imagePath)).toString("base64");

const started = Date.now();
const res = await fetch(`${BASE_URL}/responses`, {
  method: "POST",
  headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "sam-3.1",
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: `data:${mime};base64,${data}` },
        ],
      },
    ],
  }),
});
const body = await res.text();
console.log(`sam-3.1 "${prompt}" -> ${res.status} (${Date.now() - started} ms)`);
// The output format isn't documented in detail yet, so print the raw response, trimmed.
console.log(body.length > 4000 ? `${body.slice(0, 4000)}\n... (${body.length} chars total)` : body);
