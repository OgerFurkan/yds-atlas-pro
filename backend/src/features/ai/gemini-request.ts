import type { ServerConfig } from "../../config/env";
import { HttpError } from "../../shared/errors";
import { assertGeminiResponse, retryDelaySeconds } from "./gemini-errors";
import { coolGeminiKey, geminiPoolError, nextGeminiKey } from "./gemini-keys";
import { thinkingConfigFor } from "./gemini-generation";

const RATE_LIMIT_FALLBACK_SECONDS = 60;
const AUTH_COOLDOWN_SECONDS = 600;

const TRANSIENT_UPSTREAM_STATUSES = new Set([500, 502, 503, 504]);
// Separate Google model capacities can fail independently. This is a bounded
// safety net for chat only; authentication and quota failures never trigger it.
const CHAT_FALLBACK_MODEL = "gemini-3.1-flash-lite";
const MIN_CHAT_FALLBACK_BUDGET_MS = 4_000;

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
  const keys = [...new Set(config.GEMINI_KEYS.filter(Boolean))];
  if (!keys.length)
    throw new HttpError(503, "Gemini henüz yapılandırılmadı.", "AI_NOT_CONFIGURED");

  // A single deadline covers every key and retry. A slow upstream must not
  // multiply the caller's timeout by the number of configured projects.
  const timeout = AbortSignal.timeout(request.timeoutMs);
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const startedAt = Date.now();
  const attempted = new Set<string>();
  let lastTransient: Response | undefined;
  let lastNetworkFailure = false;
  let sawKeyFailure = false;
  let transientFailures = 0;
  // Upstream 503 usually means model capacity, not exhausted project quota.
  // Try no more than 3 projects per call; 429 may use the whole key pool.
  const maxTransientAttempts = Math.min(3, keys.length * 3);
  const perKeyRetries = keys.length === 1 ? 2 : 0;
  let repeatedSingleKey = 0;
  let singleRetryAllowed = false;

  while (attempted.size < keys.length || (singleRetryAllowed && repeatedSingleKey < perKeyRetries)) {
    if (signal.aborted) break;
    const remainingKeys = keys.filter((key) => !attempted.has(key));
    const apiKey = remainingKeys.length
      ? nextGeminiKey(remainingKeys, model)
      : singleRetryAllowed && repeatedSingleKey < perKeyRetries
        ? keys[0]
        : undefined;
    if (!apiKey) break;
    if (attempted.has(apiKey)) repeatedSingleKey++;
    attempted.add(apiKey);

    let response: Response;
    const remainingMs = Math.max(0, request.timeoutMs - (Date.now() - startedAt));
    if (remainingMs < 1_000)
      throw new HttpError(504, "Gemini zamanında yanıt vermedi. Tekrar deneyebilirsin.", "AI_TIMEOUT");
    try {
      // Keep enough of the shared budget for another key when possible.
      const attemptMs = Math.min(remainingMs, keys.length > 1 ? 12_000 : remainingMs);
      const attemptSignal = AbortSignal.any([signal, AbortSignal.timeout(attemptMs)]);
      response = await request.fetcher(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: attemptSignal,
        body: JSON.stringify(request.body),
      });
    } catch {
      if (request.signal?.aborted)
        throw new HttpError(499, "İstek iptal edildi.", "AI_CANCELLED");
      if (signal.aborted) break;
      lastNetworkFailure = true;
      singleRetryAllowed = true;
      transientFailures++;
      console.error({ service, stage: "network_failover", durationMs: Date.now() - startedAt });
      if (transientFailures >= maxTransientAttempts) break;
      await waitForRetry(250 * transientFailures, signal).catch(() => undefined);
      continue;
    }

    if (response.status === 429) {
      sawKeyFailure = true;
      const wait = (await retryDelaySeconds(response)) ?? RATE_LIMIT_FALLBACK_SECONDS;
      coolGeminiKey(model, apiKey, "rate_limit", wait);
      console.error({ service, stage: "key_rotation", status: 429, retryInSeconds: wait });
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      sawKeyFailure = true;
      coolGeminiKey(model, apiKey, "auth", AUTH_COOLDOWN_SECONDS);
      console.error({ service, stage: "key_rotation", status: response.status });
      continue;
    }
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
        sawKeyFailure = true;
        coolGeminiKey(model, apiKey, "auth", AUTH_COOLDOWN_SECONDS);
        console.error({ service, stage: "key_rotation", status: response.status });
        continue;
      }
      if (TRANSIENT_UPSTREAM_STATUSES.has(response.status)) {
        lastTransient = response;
        singleRetryAllowed = true;
        transientFailures++;
        console.error({ service, stage: "upstream_failover", status: response.status, attempt: transientFailures });
        if (transientFailures >= maxTransientAttempts) break;
        await waitForRetry(Math.min(1200, 300 * transientFailures), signal).catch(() => undefined);
        continue;
      }
    }
    return response;
  }

  if (request.signal?.aborted)
    throw new HttpError(499, "İstek iptal edildi.", "AI_CANCELLED");
  if (timeout.aborted)
    throw new HttpError(504, "Gemini zamanında yanıt vermedi. Tekrar deneyebilirsin.", "AI_TIMEOUT");
  if (lastTransient) {
    const remainingMs = request.timeoutMs - (Date.now() - startedAt);
    if (
      service === "gemini-chat" &&
      model === "gemini-3.5-flash-lite" &&
      !sawKeyFailure &&
      remainingMs >= MIN_CHAT_FALLBACK_BUDGET_MS
    ) {
      // When all attempted projects hit a temporary upstream failure, switching
      // keys is ineffective. Try another supported Lite model exactly once.
      // The recursive call cannot fallback again: its model is different.
      console.warn({
        service,
        stage: "model_fallback",
        fromModel: model,
        toModel: CHAT_FALLBACK_MODEL,
        status: lastTransient.status,
      });
      return requestGeminiContent({
        ...request,
        model: CHAT_FALLBACK_MODEL,
        timeoutMs: remainingMs,
      });
    }
    return lastTransient;
  }
  if (lastNetworkFailure)
    throw new HttpError(503, "Gemini bağlantısı geçici olarak kurulamadı.", "AI_NETWORK_ERROR");
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
