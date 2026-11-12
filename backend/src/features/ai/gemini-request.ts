import type { ServerConfig } from "../../config/env";
import { HttpError } from "../../shared/errors";
import { thinkingConfigFor } from "./gemini-generation";
import { assertGeminiResponse } from "./gemini-errors";

type JsonRequest = {
  service: string;
  system: string;
  payload: unknown;
  schema: unknown;
  maxOutputTokens: number;
  timeoutMs: number;
  config: ServerConfig;
  signal?: AbortSignal;
  fetcher: typeof fetch;
};

// Model and endpoint combinations differ in structured-output support. Chat works with plain
// text, so if schema-constrained JSON is rejected we retry once without the schema and let
// the Zod validation in the caller enforce the contract.
export async function requestGeminiJson(request: JsonRequest): Promise<Response> {
  const timeout = AbortSignal.timeout(request.timeoutMs);
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${request.config.GEMINI_MODEL}:generateContent`;

  function body(structured: boolean) {
    return JSON.stringify({
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(request.payload) }] }],
      generationConfig: {
        maxOutputTokens: request.maxOutputTokens,
        ...(structured
          ? { responseMimeType: "application/json", responseJsonSchema: request.schema }
          : {}),
        ...thinkingConfigFor(request.config.GEMINI_MODEL),
      },
    });
  }

  async function send(structured: boolean) {
    try {
      return await request.fetcher(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": request.config.GEMINI_API_KEY!,
        },
        signal,
        body: body(structured),
      });
    } catch {
      if (request.signal?.aborted) throw new HttpError(499, "İstek iptal edildi.", "AI_CANCELLED");
      if (!timeout.aborted)
        throw new HttpError(503, "Gemini sunucusuna bağlanılamadı.", "AI_NETWORK_ERROR");
      throw new HttpError(
        504,
        "Gemini zamanında yanıt vermedi. Daha sonra yeniden dene.",
        "AI_TIMEOUT",
      );
    }
  }

  const response = await send(true);
  try {
    await assertGeminiResponse(response, request.service);
    return response;
  } catch (error) {
    if (
      request.signal?.aborted ||
      !(error instanceof HttpError) ||
      (error.code !== "AI_REQUEST_REJECTED" && error.code !== "AI_UPSTREAM_ERROR")
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
