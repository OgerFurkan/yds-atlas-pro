import { expect, test } from "bun:test";
import type { ServerConfig } from "../src/config/env";
import { requestGeminiJson, resetGeminiJsonSchemaCooldown } from "../src/features/ai/gemini-request";

type MockFetch = (url: unknown, init?: RequestInit) => Promise<Response>;
function options(fetcher: MockFetch, key: string) {
  return {
    config: { GEMINI_KEYS: [key] } as ServerConfig,
    service: "gemini-structured-contract-test",
    model: "gemini-3.5-flash-lite",
    system: "Return JSON only.",
    payload: { word: "initial" },
    schema: { type: "object", properties: { word: { type: "string" } }, required: ["word"] },
    maxOutputTokens: 512,
    timeoutMs: 8_000,
    fetcher: fetcher as typeof fetch,
  };
}
function usesSchema(init?: RequestInit) {
  return Object.hasOwn(JSON.parse(String(init?.body)).generationConfig, "responseJsonSchema");
}

test("successful plain fallback avoids repeated structured-schema HTTP 400 on the same model", async () => {
  resetGeminiJsonSchemaCooldown();
  const structured: boolean[] = [];
  const fetcher: MockFetch = async (_url, init) => {
    const active = usesSchema(init);
    structured.push(active);
    return active
      ? Response.json({ error: { status: "INVALID_ARGUMENT" } }, { status: 400 })
      : Response.json({ candidates: [{ content: { parts: [{ text: '{"word":"initial"}' }] } }] });
  };
  const config = options(fetcher, "isolated-json-schema-key-a");
  const first = await requestGeminiJson(config);
  const second = await requestGeminiJson(config);
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(structured).toEqual([true, false, false]);
  resetGeminiJsonSchemaCooldown();
});

test("schema fallback cooldown is isolated by injected fetch transport", async () => {
  resetGeminiJsonSchemaCooldown();
  const a: boolean[] = [];
  const b: boolean[] = [];
  const rejected: MockFetch = async (_url, init) => {
    const active = usesSchema(init);
    a.push(active);
    return active ? new Response("{}", { status: 400 }) : Response.json({ word: "initial" });
  };
  const supported: MockFetch = async (_url, init) => {
    b.push(usesSchema(init));
    return Response.json({ word: "initial" });
  };
  await requestGeminiJson(options(rejected, "isolated-json-schema-key-b"));
  await requestGeminiJson(options(supported, "isolated-json-schema-key-c"));
  expect(a).toEqual([true, false]);
  expect(b).toEqual([true]);
  resetGeminiJsonSchemaCooldown();
});

test("failed plain fallback does not disable structured JSON for later requests", async () => {
  resetGeminiJsonSchemaCooldown();
  const structured: boolean[] = [];
  const fetcher: MockFetch = async (_url, init) => {
    const active = usesSchema(init);
    structured.push(active);
    return structured.length <= 2
      ? new Response("{}", { status: 400 })
      : Response.json({ word: "initial" });
  };
  const config = options(fetcher, "isolated-json-schema-key-d");
  await expect(requestGeminiJson(config)).rejects.toMatchObject({ code: "AI_REQUEST_REJECTED" });
  const response = await requestGeminiJson(config);
  expect(response.status).toBe(200);
  expect(structured).toEqual([true, false, true]);
  resetGeminiJsonSchemaCooldown();
});
