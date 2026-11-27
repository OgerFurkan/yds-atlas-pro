import type { ServerConfig } from "../../config/env";
import { HttpError } from "../../shared/errors";
import { requestGeminiContent, resolvedGeminiModel } from "./gemini-content-request";
import { assertGeminiResponse } from "./gemini-errors";
import { thinkingConfigFor } from "./gemini-generation";

export {
  geminiCapacityStatus,
  requestGeminiContent,
  resetGeminiModelCapacity,
  resolvedGeminiModel,
} from "./gemini-content-request";

// If plain JSON succeeds after a structured-schema HTTP 400, keep that proven
// transport/model combination on the validated plain path briefly. Real requests
// share fetch; injected test transports remain isolated and never share state.
const JSON_SCHEMA_COOLDOWN_MS = 15 * 60_000;
let jsonSchemaCooldowns = new WeakMap<typeof fetch, Map<string, number>>();
export function resetGeminiJsonSchemaCooldown() {
  jsonSchemaCooldowns = new WeakMap();
}
function schemaCooling(fetcher: typeof fetch, model: string): boolean {
  return (jsonSchemaCooldowns.get(fetcher)?.get(model) ?? 0) > Date.now();
}
function coolUnsupportedSchema(fetcher: typeof fetch, model: string) {
  let models = jsonSchemaCooldowns.get(fetcher);
  if (!models) {
    models = new Map();
    jsonSchemaCooldowns.set(fetcher, models);
  }
  models.set(model, Date.now() + JSON_SCHEMA_COOLDOWN_MS);
}

type JsonRequest = {
  service: string;
  config: ServerConfig;
  model: string;
  system: string;
  payload: unknown;
  schema: unknown;
  /** Bounded schema-free transport retry; caller still validates every field. */
  preferPlainJson?: boolean;
  /** Word lists confirm a schema fallback only after accepting a word from that response. */
  onWordListFallback?: (confirm: () => void) => void;
  maxOutputTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
  fetcher: typeof fetch;
};

// Model and endpoint combinations differ in structured-output support. Chat works with plain
// text, so if schema-constrained JSON is rejected we retry once without the schema and let
// the Zod validation in the caller enforce the contract.
export async function requestGeminiJson(request: JsonRequest): Promise<Response> {
  const wordList = Boolean(request.onWordListFallback);
  // A different JSON task on the same model cannot validate the word-list contract.
  const cooldownKey = wordList ? `word-list/${request.model}` : request.model;
  function body(structured: boolean) {
    // In MIME-only mode Gemini still needs the field names and envelope shape.
    const system =
      wordList && !structured
        ? `${request.system}\nReturn JSON matching this schema: ${JSON.stringify(request.schema)}`
        : request.system;
    return {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(request.payload) }] }],
      generationConfig: {
        maxOutputTokens: request.maxOutputTokens,
        ...((structured || wordList) && { responseMimeType: "application/json" }),
        ...(structured && { responseJsonSchema: request.schema }),
        ...thinkingConfigFor(request.model),
      },
    };
  }

  async function send(structured: boolean) {
    return requestGeminiContent({
      config: request.config,
      model: request.model,
      service: request.service,
      body: body(structured),
      timeoutMs: request.timeoutMs,
      signal: request.signal,
      fetcher: request.fetcher,
    });
  }

  // When a caller observed an invalid HTTP 200 envelope, it can spend its
  // one remaining bounded retry without the provider schema. This does not
  // bypass the strict Zod validation performed by the caller.
  if (request.preferPlainJson) {
    const plain = await send(false);
    await assertGeminiResponse(plain, request.service);
    return plain;
  }

  // Skip a repeatedly rejected schema only after a prior plain JSON success.
  // Callers still validate the returned object with their existing Zod schema.
  if (schemaCooling(request.fetcher, cooldownKey)) {
    const plain = await send(false);
    await assertGeminiResponse(plain, request.service);
    return plain;
  }

  const response = await send(true);
  try {
    await assertGeminiResponse(response, request.service);
    return response;
  } catch (error) {
    if (
      request.signal?.aborted ||
      !(error instanceof HttpError) ||
      error.code !== "AI_REQUEST_REJECTED"
    )
      throw error;
    console.error({
      service: request.service,
      stage: "structured_fallback",
      code: error.code,
    });
    const fallback = await send(false);
    await assertGeminiResponse(fallback, request.service);
    if (request.onWordListFallback) {
      request.onWordListFallback(() => {
        if (
          resolvedGeminiModel(response, request.model) === request.model &&
          resolvedGeminiModel(fallback, request.model) === request.model
        ) {
          coolUnsupportedSchema(request.fetcher, cooldownKey);
        }
      });
    } else {
      coolUnsupportedSchema(request.fetcher, cooldownKey);
    }
    return fallback;
  }
}

// Plain-text JSON mode may wrap the object in a markdown fence or add a short sentence.
export function parseGeminiJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(trimmed);
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed);
}
