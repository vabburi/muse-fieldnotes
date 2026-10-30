// Smoke test for Muse Spark Open (the verifier model) on one host: lists the host's models, then
// one plain call, one with an image, and one with strict JSON output. Prints latency, usage and
// the request id.
// Usage: node --env-file=.env scripts/spark-open-hello.mjs baseten|fireworks|modal [path/to/image.jpg]
import { readFile } from "node:fs/promises";

const HOSTS = {
  baseten: {
    baseUrl: process.env.BASETEN_BASE_URL ?? "https://inference.baseten.co/v1",
    model: process.env.VERIFIER_MODEL_ID ?? "meta-models/muse-spark-open-1026",
    key: process.env.BASETEN_API_KEY,
    needs: "BASETEN_API_KEY",
  },
  fireworks: {
    baseUrl: "https://api.fireworks.ai/inference/v1",
    model: process.env.FIREWORKS_MODEL_ID ?? "accounts/fireworks/models/muse-spark-open",
    key: process.env.FIREWORKS_API_KEY,
    needs: "FIREWORKS_API_KEY",
  },
  modal: {
    baseUrl: process.env.MODAL_BASE_URL ?? "https://inference.us-west.modal.direct/v1",
    model: process.env.MODAL_MODEL_ID ?? "",
    key:
      process.env.MODAL_PROXY_TOKEN_ID && process.env.MODAL_PROXY_TOKEN_SECRET
        ? `${process.env.MODAL_PROXY_TOKEN_ID}.${process.env.MODAL_PROXY_TOKEN_SECRET}`
        : undefined,
    needs: "MODAL_PROXY_TOKEN_ID and MODAL_PROXY_TOKEN_SECRET",
  },
};
const host = HOSTS[process.argv[2]];
if (!host) {
  console.error(`Usage: spark-open-hello.mjs ${Object.keys(HOSTS).join("|")} [image.jpg]`);
  process.exit(1);
}
const { baseUrl: BASE_URL, model: MODEL, key: API_KEY } = host;
// Spark Open reasons before answering; a small token cap is spent entirely on reasoning.
const EFFORT = process.env.REASONING_EFFORT ?? "low";

if (!API_KEY) {
  console.error(`Set ${host.needs} in .env (git-ignored).`);
  process.exit(1);
}

// The model id this host expects; check it against MODEL above.
const models = await fetch(`${BASE_URL}/models`, { headers: { Authorization: `Bearer ${API_KEY}` } });
const listed = models.ok ? ((await models.json()).data ?? []).map((m) => m.id) : [];
console.log(`Models (${models.status}):`, listed.filter((id) => /muse/i.test(id)).join(", ") || listed.length);
if (!MODEL) {
  console.error("Set MODAL_MODEL_ID in .env to the Muse Spark Open id listed above.");
  process.exit(1);
}

async function chat(label, body) {
  const started = Date.now();
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, reasoning_effort: EFFORT, ...body }),
  });
  const text = await res.text();
  const requestId = res.headers.get("x-baseten-request-id") ?? res.headers.get("x-request-id") ?? res.headers.get("modal-call-id");
  if (!res.ok) {
    console.error(`${label}: ${res.status} (request ${requestId})\n${text}`);
    return;
  }
  const reply = JSON.parse(text);
  console.log(`\n${label} (${Date.now() - started} ms, request ${requestId}):`);
  console.log(reply.choices?.[0]?.message?.content, `(finish: ${reply.choices?.[0]?.finish_reason})`);
  console.log("Usage:", reply.usage);
}

await chat("Text", { messages: [{ role: "user", content: "Say hello in five words." }] });

const imagePath = process.argv[3];
if (imagePath) {
  const data = (await readFile(imagePath)).toString("base64");
  await chat("Image", {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Describe the equipment in this photo in one sentence." },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${data}` } },
        ],
      },
    ],
  });
}

// The shape the verifier will ask for on every line.
await chat("Structured", {
  messages: [
    {
      role: "user",
      content:
        'Source S4 (voice note): "Flame sensor read 0.8 microamps, cleaned it, now 3.1."\n' +
        'Line: "Flame sensor read 1.8 µA before cleaning." [S4]\n' +
        "Does the source support the line?",
    },
  ],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "verdict",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["status", "reason"],
        properties: {
          status: { type: "string", enum: ["supported", "partial", "unsupported"] },
          reason: { type: "string" },
        },
      },
    },
  },
});
