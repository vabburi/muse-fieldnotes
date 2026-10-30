// Smoke test for the Meta Model API: list models, then send Muse Spark one image.
// Usage: node --env-file=.env scripts/hello.mjs [path/to/image.jpg]
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const BASE_URL = process.env.MODEL_API_BASE_URL ?? "https://api.meta.ai/v1";
const API_KEY = process.env.MODEL_API_KEY;
const MODEL = process.env.MODEL_ID ?? "muse-spark-1.3";

if (!API_KEY) {
  console.error("MODEL_API_KEY is not set. Add it to .env (git-ignored).");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };

async function call(path, init) {
  const res = await fetch(`${BASE_URL}${path}`, { headers, ...init });
  const body = await res.text();
  if (!res.ok) {
    console.error(`${init?.method ?? "GET"} ${path} -> ${res.status}\n${body}`);
    process.exit(1);
  }
  return JSON.parse(body);
}

const models = await call("/models");
console.log("Models:", models.data?.map((m) => m.id).join(", ") ?? models);

const imagePath = process.argv[2];
const content = [{ type: "text", text: "Describe the equipment in this photo in one sentence." }];
if (imagePath) {
  const mime = { ".png": "image/png", ".webp": "image/webp" }[extname(imagePath).toLowerCase()] ?? "image/jpeg";
  const data = (await readFile(imagePath)).toString("base64");
  content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${data}` } });
} else {
  content[0].text = "Say hello in five words.";
}

const started = Date.now();
const reply = await call("/chat/completions", {
  method: "POST",
  body: JSON.stringify({
    model: MODEL,
    messages: [{ role: "user", content }],
    ...(process.env.REASONING_EFFORT && { reasoning_effort: process.env.REASONING_EFFORT }),
  }),
});
console.log(`\n${MODEL} (${Date.now() - started} ms):`, reply.choices?.[0]?.message?.content);
console.log("Usage:", reply.usage);
