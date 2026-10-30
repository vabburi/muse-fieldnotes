import "server-only";

// Thin client for the Meta Model API. Server-only: the key never reaches the browser.
const BASE_URL = process.env.MODEL_API_BASE_URL ?? "https://api.meta.ai/v1";

export class MetaApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Meta Model API ${status}: ${body.slice(0, 500)}`);
  }
}

export async function metaPost<T>(path: string, body: unknown): Promise<T> {
  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey) throw new Error("MODEL_API_KEY is not set");

  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new MetaApiError(res.status, text);
  return JSON.parse(text) as T;
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

interface ChatCompletion {
  choices: { message: { content: string | null } }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export interface JsonResult<T> {
  data: T;
  ms: number;
  usage?: ChatCompletion["usage"];
}

// One chat call whose reply must match `schema` (structured output, strict mode).
export async function chatJson<T>(opts: {
  model?: string;
  messages: ChatMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
  reasoningEffort?: "low" | "medium" | "high";
}): Promise<JsonResult<T>> {
  const started = Date.now();
  const completion = await metaPost<ChatCompletion>("/chat/completions", {
    model: opts.model ?? process.env.MODEL_ID ?? "muse-spark-1.3",
    messages: opts.messages,
    response_format: {
      type: "json_schema",
      json_schema: { name: opts.schemaName, strict: true, schema: opts.schema },
    },
    ...(opts.reasoningEffort && { reasoning_effort: opts.reasoningEffort }),
  });
  const content = completion.choices[0]?.message.content;
  if (!content) throw new Error(`${opts.schemaName}: empty reply`);
  return { data: JSON.parse(content) as T, ms: Date.now() - started, usage: completion.usage };
}

// --- Responses API, for the agent loop (function tools, one call per turn) -------------

export type ResponseInputPart = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };

// What goes into `input`: messages, plus the model's own output items and tool results,
// sent back unchanged each turn (store: false, so the whole conversation travels every time).
export type ResponseItem =
  | { role: "user"; content: string | ResponseInputPart[] }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string }
  | { type: "message"; role: "assistant"; content: { type: string; text?: string }[] }
  | { type: "reasoning"; [key: string]: unknown };

export interface FunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: true;
}

export interface ResponsesResult {
  output: ResponseItem[];
  usage?: { input_tokens: number; output_tokens: number };
  ms: number;
}

export async function responsesCreate(opts: {
  instructions: string;
  input: ResponseItem[];
  tools: FunctionTool[];
  reasoningEffort?: "low" | "medium" | "high";
}): Promise<ResponsesResult> {
  const started = Date.now();
  const res = await metaPost<Omit<ResponsesResult, "ms">>("/responses", {
    model: process.env.MODEL_ID ?? "muse-spark-1.3",
    instructions: opts.instructions,
    input: opts.input,
    tools: opts.tools,
    parallel_tool_calls: false,
    store: false,
    ...(opts.reasoningEffort && { reasoning: { effort: opts.reasoningEffort } }),
  });
  return { ...res, ms: Date.now() - started };
}
