import { expect, test } from "bun:test";
import type { ServerConfig } from "../src/config/env";
import { requestGeminiContent } from "../src/features/ai/gemini-request";

type FetchMock = (url: unknown, init?: RequestInit) => Promise<Response>;

function request(fetcher: FetchMock, service = "gemini-chat", keys = ["test-key-one", "test-key-two"]) {
  return requestGeminiContent({
    config: { GEMINI_KEYS: keys } as ServerConfig,
    model: "gemini-3.5-flash-lite",
    service,
    body: { contents: [{ role: "user", parts: [{ text: "Indicate ne demek?" }] }] },
    timeoutMs: 12_000,
    fetcher: fetcher as typeof fetch,
  });
}

test("chat switches to 3.1 Flash-Lite after primary 503 responses", async () => {
  const visited: string[] = [];
  const response = await request(async (url) => {
    visited.push(String(url));
    return new Response("{}", { status: String(url).includes("gemini-3.1-flash-lite") ? 200 : 503 });
  });
  expect(response.status).toBe(200);
  expect(visited.filter((url) => url.includes("gemini-3.5-flash-lite"))).toHaveLength(2);
  expect(visited.filter((url) => url.includes("gemini-3.1-flash-lite"))).toHaveLength(1);
});

test("word generation does not switch models after upstream failures", async () => {
  const visited: string[] = [];
  const response = await request(async (url) => {
    visited.push(String(url));
    return new Response("{}", { status: 503 });
  }, "gemini-word");
  expect(response.status).toBe(503);
  expect(visited).toHaveLength(2);
  expect(visited.every((url) => url.includes("gemini-3.5-flash-lite"))).toBe(true);
});

test("429 does not switch chat models or evade project quota", async () => {
  const visited: string[] = [];
  await expect(request(async (url) => {
    visited.push(String(url));
    return new Response("{}", { status: 429 });
  })).rejects.toBeDefined();
  expect(visited).toHaveLength(2);
  expect(visited.every((url) => url.includes("gemini-3.5-flash-lite"))).toBe(true);
});

test("both unavailable models stop after a bounded number of requests", async () => {
  const visited: string[] = [];
  const response = await request(async (url) => {
    visited.push(String(url));
    return new Response("{}", { status: 503 });
  }, "gemini-chat", ["isolated-key"]);
  expect(response.status).toBe(503);
  expect(visited.filter((url) => url.includes("gemini-3.5-flash-lite"))).toHaveLength(3);
  expect(visited.filter((url) => url.includes("gemini-3.1-flash-lite"))).toHaveLength(3);
});
