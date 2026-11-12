import type { ServerConfig } from "../../config/env";
import { HttpError } from "../../shared/errors";
import { assertGeminiResponse, retryDelaySeconds } from "./gemini-errors";
import { coolGeminiKey, geminiPoolError, nextGeminiKey } from "./gemini-keys";
import { thinkingConfigFor } from "./gemini-generation";

const RATE_LIMIT_FALLBACK_SECONDS = 60;
const AUTH_COOLDOWN_SECONDS = 600;

const TRANSIENT_UPSTREAM_STATUSES = new Set([500, 502, 503, 504]);
const UPSTREAM_RETRY_DELAYS_MS = [1000, 2000] as const;

// Uses the same combined signal as fetch, so both user cancellation and the
// request-wide timeout interrupt the backoff immediately.
function waitForRetry(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

type ProviderError = {
  error?: { status?: string; details?: { reason?: string; retryDelay?: string }[] };
};

export type GeminiContentRequest = {
  config: ServerConfig;
  model: string;
  service: string;
  body: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
  fetcher: typeof fetch;
};

// Sends one generateContent request. Rate-limited or rejected keys are parked and
// the next project's key is tried, so one exhausted project does not fail the user.
export async function requestGeminiContent(request: GeminiContentRequest): Promise<Response> {
  const { config, model, service } = request;
  if (!config.GEMINI_KEYS.length)
    throw new HttpError(503, "Gemini henüz yapılandırılmadı.", "AI_NOT_CONFIGURED");
  const timeout = AbortSignal.timeout(request.timeoutMs);
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const startedAt = Date.now();
  let transientRetries = 0;

  for (let attempt = 0; attempt < config.GEMINI_KEYS.length; attempt++) {
    const apiKey = nextGeminiKey(config.GEMINI_KEYS, model);
    if (!apiKey) break;
    let response: Response;
    try {
      // Retry temporary upstream failures without changing the selected API key.
      // The retry budget is shared across the entire request, not per API key.
      while (true) {
        response = await request.fetcher(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          signal,
          body: JSON.stringify(request.body),
        });
        if (
          !TRANSIENT_UPSTREAM_STATUSES.has(response.status) ||
          transientRetries >= UPSTREAM_RETRY_DELAYS_MS.length
        ) break;

        const delayMs = UPSTREAM_RETRY_DELAYS_MS[transientRetries];
        transientRetries++;
        console.error({ service, stage: "upstream_retry", status: response.status, retry: transientRetries });
        await waitForRetry(delayMs, signal);
      }
    } catch {
      if (request.signal?.aborted) throw new HttpError(499, "İstek iptal edildi.", "AI_CANCELLED");
      console.error({ service, timedOut: timeout.aborted, durationMs: Date.now() - startedAt });
      if (!timeout.aborted)
        throw new HttpError(503, "Gemini sunucusuna bağlanılamadı.", "AI_NETWORK_ERROR");
      throw new HttpError(
        504,
        "Gemini zamanında yanıt vermedi. Daha sonra yeniden dene.",
        "AI_TIMEOUT",
      );
    }

    if (response.status === 429) {
      const wait = (await retryDelaySeconds(response)) ?? RATE_LIMIT_FALLBACK_SECONDS;
      coolGeminiKey(model, apiKey, "rate_limit", wait);
      console.error({ service, stage: "key_rotation", status: 429, retryInSeconds: wait });
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      coolGeminiKey(model, apiKey, "auth", AUTH_COOLDOWN_SECONDS);
      console.error({ service, stage: "key_rotation", status: response.status });
      continue;
    }
    // Invalid keys are also reported as 400 with an API_KEY_INVALID reason.
    if (!response.ok) {
      const invalidKey = await response
        .clone()
        .json()
        .then((payload: ProviderError | null) =>
          payload?.error?.details?.some((detail) =>
            ["API_KEY_INVALID", "API_KEY_EXPIRED"].includes(detail.reason ?? ""),
          ),
        )
        .catch(() => false);
      if (invalidKey) {
        coolGeminiKey(model, apiKey, "auth", AUTH_COOLDOWN_SECONDS);
        console.error({ service, stage: "key_rotation", status: response.status });
        continue;
      }
    }
    return response;
  }

  throw geminiPoolError(config.GEMINI_KEYS, model);
}

type JsonRequest = {
  service: string;
  config: ServerConfig;
  model: string;
  system: string;
  payload: unknown;
  schema: unknown;
  maxOutputTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
  fetcher: typeof fetch;
};

// Model and endpoint combinations differ in structured-output support. Chat works with plain
// text, so if schema-constrained JSON is rejected we retry once without the schema and let
// the Zod validation in the caller enforce the contract.
export async function requestGeminiJson(request: JsonRequest): Promise<Response> {
  function body(structured: boolean) {
    return {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(request.payload) }] }],
      generationConfig: {
        maxOutputTokens: request.maxOutputTokens,
        ...(structured
          ? { responseMimeType: "application/json", responseJsonSchema: request.schema }
          : {}),
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
