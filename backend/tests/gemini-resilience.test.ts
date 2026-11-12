import { expect, test } from "bun:test";
import type { ServerConfig } from "../src/config/env";
import { requestGeminiContent } from "../src/features/ai/gemini-request";

// Bun's fetch also exposes `preconnect`. The dependency-injected test stub only
// needs to implement the callable fetch signature, not Bun-specific extensions.
type MockFetcher = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

function options(keys: string[], fetcher: MockFetcher, model: string) {
  return {
    config: { GEMINI_KEYS: keys } as ServerConfig,
    fetcher: fetcher as typeof fetch,
    model,
    service: "gemini-resilience-test",
    body: { contents: [] },
    timeoutMs: 10_000,
  };
}

test("503 on one project uses a different project without exposing keys", async () => {
  const requested: string[] = [];
  const fetcher: MockFetcher = async (_url, init) => {
    const key = new Headers(init?.headers).get("x-goog-api-key") ?? "";
    requested.push(key);
    return new Response("{}", { status: requested.length === 1 ? 503 : 200 });
  };
  const response = await requestGeminiContent(options(["test-503-a", "test-503-b"], fetcher, "gemini-res-503"));
  expect(response.status).toBe(200);
  expect(requested).toHaveLength(2);
  expect(new Set(requested).size).toBe(2);
});

test("429 cools one key and selects a different key", async () => {
  const requested: string[] = [];
  const fetcher: MockFetcher = async (_url, init) => {
    requested.push(new Headers(init?.headers).get("x-goog-api-key") ?? "");
    return new Response("{}", { status: requested.length === 1 ? 429 : 200 });
  };
  const response = await requestGeminiContent(options(["test-429-a", "test-429-b"], fetcher, "gemini-res-429"));
  expect(response.status).toBe(200);
  expect(new Set(requested).size).toBe(2);
});

test("503 failover has a strict bound even when five projects are configured", async () => {
  let count = 0;
  const fetcher: MockFetcher = async () => {
    count++;
    return new Response("{}", { status: 503 });
  };
  const response = await requestGeminiContent(options(["a-503", "b-503", "c-503", "d-503", "e-503"], fetcher, "gemini-res-bounded"));
  expect(response.status).toBe(503);
  expect(count).toBe(3);
});

test("a single project retries a transient 500 at most twice", async () => {
  let count = 0;
  const fetcher: MockFetcher = async () => {
    count++;
    return new Response("{}", { status: count < 3 ? 500 : 200 });
  };
  const response = await requestGeminiContent(options(["test-single-500"], fetcher, "gemini-res-one"));
  expect(response.status).toBe(200);
  expect(count).toBe(3);
});
