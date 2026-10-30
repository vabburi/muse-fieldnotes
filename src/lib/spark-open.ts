import "server-only";

import type { ChatMessage, ReasoningEffort } from "./meta";

// Muse Spark Open (Meta's open weights) on three hosts, all OpenAI-compatible: Baseten first,
// then Fireworks, then Modal. A host is used only when its key is in .env. Server-only: keys
// never reach the browser.

export interface Provider {
  name: "baseten" | "fireworks" | "modal";
  label: string;
  baseUrl: string;
  model: string;
  key: string | undefined;
}

export const PROVIDERS: Provider[] = [
  {
    name: "baseten",
    label: "Baseten",
    baseUrl: process.env.BASETEN_BASE_URL ?? "https://inference.baseten.co/v1",
    model: process.env.VERIFIER_MODEL_ID ?? "meta-models/muse-spark-open-1026",
    key: process.env.BASETEN_API_KEY,
  },
  {
    name: "fireworks",
    label: "Fireworks",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    model: process.env.FIREWORKS_MODEL_ID ?? "accounts/fireworks/models/muse-spark-open",
    key: process.env.FIREWORKS_API_KEY,
  },
  {
    name: "modal",
    label: "Modal",
    // A Modal Shared Endpoint, picked by its host name in the model field
    // (GET /v1/models lists it as <workspace>--ep-muse-spark-open-816b-a42b-server.us-west.modal.direct).
    baseUrl: process.env.MODAL_BASE_URL ?? "https://inference.us-west.modal.direct/v1",
    model: process.env.MODAL_MODEL_ID ?? "",
    key:
      process.env.MODAL_PROXY_TOKEN_ID && process.env.MODAL_PROXY_TOKEN_SECRET && process.env.MODAL_MODEL_ID
        ? `${process.env.MODAL_PROXY_TOKEN_ID}.${process.env.MODAL_PROXY_TOKEN_SECRET}`
        : undefined,
  },
];

export type ProviderName = Provider["name"];

// Host order, e.g. VERIFIER_HOSTS=modal,baseten,fireworks. Hosts left out are not used.
const ORDER = (process.env.VERIFIER_HOSTS ?? "baseten,fireworks,modal").split(",").map((h) => h.trim());

// The hosts to try, in order: all configured ones, or just `only`.
export function providerChain(only?: ProviderName): Provider[] {
  const ordered = ORDER.flatMap((name) => PROVIDERS.filter((p) => p.name === name));
  const chain = (only ? PROVIDERS : ordered).filter((p) => p.key && (!only || p.name === only));
  if (chain.length === 0) throw new Error(only ? `${only} is not configured` : "No Muse Spark Open host is configured");
  return chain;
}

export class ProviderApiError extends Error {
  constructor(
    readonly provider: ProviderName,
    readonly status: number,
    readonly body: string,
    readonly requestId?: string,
  ) {
    super(`${provider} ${status}: ${body.slice(0, 500)}`);
  }
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
}

export interface SparkOpenResult<T> {
  data: T;
  provider: ProviderName;
  model: string;
  ms: number;
  usage?: Usage;
  requestId?: string;
  // Hosts that failed before this one answered.
  failedOver: { provider: ProviderName; error: string }[];
}

interface JsonRequest {
  messages: ChatMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
  reasoningEffort?: ReasoningEffort;
  maxTokens?: number;
}

// One chat call on one host whose reply must match `schema` (structured output, strict mode).
// Spark Open reasons before it answers, so the token cap must leave room for that.
async function callOne<T>(provider: Provider, opts: JsonRequest) {
  const started = Date.now();
  // Higher effort thinks longer: more room for reasoning tokens and more time (evals only; the
  // app runs at low).
  const deep = opts.reasoningEffort && !["minimal", "low"].includes(opts.reasoningEffort);
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${provider.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: provider.model,
      messages: opts.messages,
      max_tokens: opts.maxTokens ?? (deep ? 16000 : 4000),
      reasoning_effort: opts.reasoningEffort ?? "low",
      response_format: {
        type: "json_schema",
        json_schema: { name: opts.schemaName, strict: true, schema: opts.schema },
      },
    }),
    // Short enough that a stuck host still leaves time for the next one.
    signal: AbortSignal.timeout(deep ? 180_000 : 30_000),
  });
  const headerId =
    res.headers.get("x-baseten-request-id") ?? res.headers.get("x-request-id") ?? res.headers.get("modal-call-id");
  const text = await res.text();
  if (!res.ok) throw new ProviderApiError(provider.name, res.status, text, headerId ?? undefined);

  const completion = JSON.parse(text) as {
    id?: string;
    choices: { message: { content: string | null }; finish_reason?: string }[];
    usage?: Usage;
  };
  const choice = completion.choices[0];
  if (!choice?.message.content) throw new Error(`${opts.schemaName}: empty reply (${choice?.finish_reason})`);
  return {
    data: JSON.parse(choice.message.content) as T,
    ms: Date.now() - started,
    usage: completion.usage,
    requestId: headerId ?? completion.id,
  };
}

// Tries each host in the chain once; a lone host gets two more tries, a few seconds apart, since
// Modal's shared endpoint answers 429 when many lines are checked at once. The last error is
// thrown only when every host failed.
export async function sparkOpenJson<T>(opts: JsonRequest & { only?: ProviderName }): Promise<SparkOpenResult<T>> {
  const chain = providerChain(opts.only);
  const attempts = chain.length === 1 ? [chain[0], chain[0], chain[0]] : chain;
  const failedOver: SparkOpenResult<T>["failedOver"] = [];
  let lastError: unknown;
  for (const [i, provider] of attempts.entries()) {
    if (i > 0 && provider === attempts[i - 1]) await new Promise((r) => setTimeout(r, 2000 * i + Math.random() * 1000));
    try {
      const result = await callOne<T>(provider, opts);
      return { ...result, provider: provider.name, model: provider.model, failedOver };
    } catch (error) {
      lastError = error;
      failedOver.push({ provider: provider.name, error: (error as Error).message.slice(0, 200) });
    }
  }
  throw lastError;
}
