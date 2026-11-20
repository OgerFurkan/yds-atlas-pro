import { expect, test } from "bun:test";
import type { ServerConfig } from "../src/config/env";
import { requestGeminiContent, resolvedGeminiModel, resetGeminiModelCapacity } from "../src/features/ai/gemini-request";

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
  resetGeminiModelCapacity();
  const visited: string[] = [];
  const response = await request(async (url) => {
    visited.push(String(url));
    return new Response("{}", { status: String(url).includes("gemini-3.1-flash-lite") ? 200 : 503 });
  });
  expect(response.status).toBe(200);
  expect(resolvedGeminiModel(response, "gemini-3.5-flash-lite")).toBe("gemini-3.1-flash-lite");
  expect(visited.filter((url) => url.includes("gemini-3.5-flash-lite"))).toHaveLength(2);
  expect(visited.filter((url) => url.includes("gemini-3.1-flash-lite"))).toHaveLength(1);
});

test("word generation switches to cheaper Lite fallback after provider 503", async () => {
  resetGeminiModelCapacity();
  const visited: string[] = [];
  const response = await request(async (url) => {
    visited.push(String(url));
    return new Response("{}", { status: String(url).includes("gemini-3.1-flash-lite") ? 200 : 503 });
  }, "gemini-word");
  expect(response.status).toBe(200);
  expect(visited).toHaveLength(3);
  expect(resolvedGeminiModel(response, "gemini-3.5-flash-lite")).toBe("gemini-3.1-flash-lite");
});

test("429 does not switch chat models or evade project quota", async () => {
  resetGeminiModelCapacity();
  const visited: string[] = [];
  await expect(request(async (url) => {
    visited.push(String(url));
    return new Response("{}", { status: 429 });
  })).rejects.toBeDefined();
  expect(visited).toHaveLength(2);
  expect(visited.every((url) => url.includes("gemini-3.5-flash-lite"))).toBe(true);
});

test("both unavailable models stop after a bounded number of requests", async () => {
  resetGeminiModelCapacity();
  const visited: string[] = [];
  const response = await request(async (url) => {
    visited.push(String(url));
    return new Response("{}", { status: 503 });
  }, "gemini-chat", ["isolated-key"]);
  expect(response.status).toBe(503);
  expect(visited.filter((url) => url.includes("gemini-3.5-flash-lite"))).toHaveLength(3);
  expect(visited.filter((url) => url.includes("gemini-3.1-flash-lite"))).toHaveLength(3);
});

test("a 503 opens a brief model-capacity gate for subsequent word requests", async () => {
  resetGeminiModelCapacity();
  const visited: string[] = [];
  const fetcher: FetchMock = async url => {
    visited.push(String(url));
    return new Response("{}", {status:String(url).includes("3.1-flash-lite") ? 200 : 503});
  };
  const keys=["capacity-probe-a","capacity-probe-b"];
  await request(fetcher,"gemini-word",keys);
  visited.length=0;
  const response=await request(fetcher,"gemini-tiered-sentence",keys);
  expect(response.status).toBe(200);
  expect(visited).toHaveLength(1);
  expect(visited[0]).toContain("gemini-3.1-flash-lite");
  resetGeminiModelCapacity();
});
test("primary model missing (404) cannot be disguised as successful fallback",async()=>{
  resetGeminiModelCapacity();
  const visited:string[]=[];
  const response=await request(async url=>{
    visited.push(String(url));
    return new Response("{}",{status:404});
  },"gemini-word-list",["missing-model-key-a","missing-model-key-b"]);
  expect(response.status).toBe(404);
  expect(visited).toHaveLength(1);
  resetGeminiModelCapacity();
});
