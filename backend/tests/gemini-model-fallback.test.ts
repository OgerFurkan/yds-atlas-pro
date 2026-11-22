import { expect, test } from "bun:test";
import type { ServerConfig } from "../src/config/env";
import {
  requestGeminiContent,
  resolvedGeminiModel,
  resetGeminiModelCapacity,
} from "../src/features/ai/gemini-request";

type FetchMock = (url: unknown, init?: RequestInit) => Promise<Response>;

function request(
  fetcher: FetchMock,
  service = "gemini-chat",
  keys = ["test-key-one", "test-key-two"],
) {
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
    return new Response("{}", {
      status: String(url).includes("gemini-3.1-flash-lite") ? 200 : 503,
    });
  });
  expect(response.status).toBe(200);
  expect(resolvedGeminiModel(response, "gemini-3.5-flash-lite")).toBe("gemini-3.1-flash-lite");
  expect(visited.filter((url) => url.includes("gemini-3.5-flash-lite"))).toHaveLength(1);
  expect(visited.filter((url) => url.includes("gemini-3.1-flash-lite"))).toHaveLength(1);
});

test("word generation switches to cheaper Lite fallback after provider 503", async () => {
  resetGeminiModelCapacity();
  const visited: string[] = [];
  const response = await request(async (url) => {
    visited.push(String(url));
    return new Response("{}", {
      status: String(url).includes("gemini-3.1-flash-lite") ? 200 : 503,
    });
  }, "gemini-word");
  expect(response.status).toBe(200);
  expect(visited).toHaveLength(2);
  expect(resolvedGeminiModel(response, "gemini-3.5-flash-lite")).toBe("gemini-3.1-flash-lite");
});

test("429 does not switch chat models or evade project quota", async () => {
  resetGeminiModelCapacity();
  const visited: string[] = [];
  await expect(
    request(async (url) => {
      visited.push(String(url));
      return new Response("{}", { status: 429 });
    }),
  ).rejects.toBeDefined();
  expect(visited).toHaveLength(2);
  expect(visited.every((url) => url.includes("gemini-3.5-flash-lite"))).toBe(true);
});

test("both unavailable models stop after a bounded number of requests", async () => {
  resetGeminiModelCapacity();
  const visited: string[] = [];
  const response = await request(
    async (url) => {
      visited.push(String(url));
      return new Response("{}", { status: 503 });
    },
    "gemini-chat",
    ["isolated-key"],
  );
  expect(response.status).toBe(503);
  expect(visited.filter((url) => url.includes("gemini-3.5-flash-lite"))).toHaveLength(1);
  expect(visited.filter((url) => url.includes("gemini-3.1-flash-lite"))).toHaveLength(3);
});

test("a 503 opens a brief model-capacity gate for subsequent word requests", async () => {
  resetGeminiModelCapacity();
  const visited: string[] = [];
  const fetcher: FetchMock = async (url) => {
    visited.push(String(url));
    return new Response("{}", { status: String(url).includes("3.1-flash-lite") ? 200 : 503 });
  };
  const keys = ["capacity-probe-a", "capacity-probe-b"];
  await request(fetcher, "gemini-word", keys);
  visited.length = 0;
  const response = await request(fetcher, "gemini-tiered-sentence", keys);
  expect(response.status).toBe(200);
  expect(visited).toHaveLength(1);
  expect(visited[0]).toContain("gemini-3.1-flash-lite");
  resetGeminiModelCapacity();
});
test("primary 404 switches to supported low-cost Lite fallback and preserves real model", async () => {
  resetGeminiModelCapacity();
  const visited: string[] = [];
  const response = await request(
    async (url) => {
      visited.push(String(url));
      return new Response("{}", {
        status: String(url).includes("gemini-3.1-flash-lite") ? 200 : 404,
      });
    },
    "gemini-word-list",
    ["missing-model-key-a", "missing-model-key-b"],
  );
  expect(response.status).toBe(200);
  expect(resolvedGeminiModel(response, "gemini-3.5-flash-lite")).toBe("gemini-3.1-flash-lite");
  expect(visited).toHaveLength(2);
  resetGeminiModelCapacity();
});

test("all five 503-prone keys do not hammer the same overloaded primary model", async () => {
  resetGeminiModelCapacity();
  const calls: string[] = [];
  const response = await request(
    async (url) => {
      calls.push(String(url));
      return new Response("{}", { status: String(url).includes("3.1-flash-lite") ? 200 : 503 });
    },
    "gemini-word",
    ["capacity-key-1", "capacity-key-2", "capacity-key-3", "capacity-key-4", "capacity-key-5"],
  );
  expect(response.status).toBe(200);
  expect(calls.filter((url) => url.includes("3.5-flash-lite"))).toHaveLength(1);
  expect(calls.filter((url) => url.includes("3.1-flash-lite"))).toHaveLength(1);
  resetGeminiModelCapacity();
});
test.each([500, 502, 504, 408])(
  "retryable upstream %i switches to second Lite model",
  async (status) => {
    resetGeminiModelCapacity();
    const response = await request(
      async (url) =>
        new Response("{}", { status: String(url).includes("3.1-flash-lite") ? 200 : status }),
      "gemini-tiered-sentence",
      ["secondary-" + status],
    );
    expect(response.status).toBe(200);
    expect(resolvedGeminiModel(response, "gemini-3.5-flash-lite")).toBe("gemini-3.1-flash-lite");
    resetGeminiModelCapacity();
  },
);
test("both retired models return 404 rather than claiming model success", async () => {
  resetGeminiModelCapacity();
  const calls: string[] = [];
  const response = await request(
    async (url) => {
      calls.push(String(url));
      return new Response("{}", { status: 404 });
    },
    "gemini-word",
    ["dead-a", "dead-b"],
  );
  expect(response.status).toBe(404);
  expect(calls).toHaveLength(2);
  resetGeminiModelCapacity();
});
