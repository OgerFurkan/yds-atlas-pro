import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import assert from "node:assert/strict";
import { readConfig } from "../../../backend/src/config/env";
import { generateChatReply } from "../../../backend/src/features/ai/chat";
import { lookupDictionaryWord } from "../../../backend/src/features/ai/dictionary-api";
import {
  generateEnrichedWord,
  generateNamedWords,
  generateWord,
  generateWordList,
} from "../../../backend/src/features/ai/gemini";
import { resetGeminiKeyPool } from "../../../backend/src/features/ai/gemini-keys";
import { HttpError } from "../../../backend/src/shared/errors";
import { suggestion } from "../fixtures/ai-word";

beforeEach(resetGeminiKeyPool);

const config = readConfig({
  GEMINI_API_KEY: "test-secret-never-return",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "test-public",
});
function upstream(value: unknown, reason = "STOP") {
  return Response.json({
    candidates: [{ finishReason: reason, content: { parts: [{ text: JSON.stringify(value) }] } }],
  });
}
const dictionaryEntry = [
  {
    word: "Expand",
    sourceUrls: ["https://en.wiktionary.org/wiki/expand"],
    license: { name: "CC BY-SA 3.0", url: "https://creativecommons.org/licenses/by-sa/3.0/" },
    meanings: [
      {
        definitions: [
          { definition: "To make larger.", example: "We expand the project each year." },
          { definition: "To explain in detail.", example: "Please expand your answer." },
          { definition: "More examples are ignored.", example: "They expand the area." },
        ],
      },
    ],
  },
];
describe("Gemini provider", () => {
  test("chat maps roles to Gemini, keeps the secret server-side, and returns bounded plain text", async () => {
    let input: RequestInit | undefined;
    const fetcher = (async (_url: unknown, init: RequestInit) => {
      input = init;
      return Response.json({
        candidates: [
          { finishReason: "STOP", content: { parts: [{ text: "Indicate means to show." }] } },
        ],
      });
    }) as unknown as typeof fetch;
    const result = await generateChatReply(
      {
        messages: [
          { role: "user", content: "Explain indicate." },
          { role: "assistant", content: "It means to show." },
          { role: "user", content: "Give an example." },
        ],
      },
      config,
      undefined,
      fetcher,
    );
    expect(result.reply).toBe("Indicate means to show.");
    assert(input);
    assert(config.GEMINI_API_KEY);
    expect(new Headers(input.headers).get("x-goog-api-key")).toBe(config.GEMINI_API_KEY);
    expect(JSON.parse(input?.body as string).generationConfig.thinkingConfig).toBeUndefined();
    expect(
      JSON.parse(input.body as string).contents.map((message: { role: string }) => message.role),
    ).toEqual(["user", "model", "user"]);
  });
  test("chat does not send thinking levels to Gemini 2.5", async () => {
    let requestBody = "";
    const fetcher = (async (_url: unknown, init: RequestInit) => {
      requestBody = String(init.body);
      return Response.json({
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Hello" }] } }],
      });
    }) as unknown as typeof fetch;
    await generateChatReply(
      { messages: [{ role: "user", content: "Hello" }] },
      { ...config, GEMINI_MODEL_CHAT: "gemini-2.5-flash" },
      undefined,
      fetcher,
    );
    expect(JSON.parse(requestBody).generationConfig.thinkingConfig).toBeUndefined();
  });
  test("chat reports actionable provider error categories without exposing upstream details", async () => {
    const messages = [{ role: "user" as const, content: "Explain indicate." }];
    for (const [status, code] of [
      [400, "AI_REQUEST_REJECTED"],
      [401, "AI_AUTH_ERROR"],
      [403, "AI_PERMISSION_DENIED"],
      [404, "AI_MODEL_NOT_FOUND"],
      [429, "AI_QUOTA_EXCEEDED"],
      [500, "AI_UPSTREAM_ERROR"],
    ] as const) {
      resetGeminiKeyPool();
      const fetcher = (async () =>
        new Response("provider secret detail", { status })) as unknown as typeof fetch;
      await expect(
        generateChatReply({ messages }, config, undefined, fetcher),
      ).rejects.toMatchObject({ code });
    }
  });
  test("chat tells the user how long to wait when Gemini rate limits", async () => {
    const messages = [{ role: "user" as const, content: "Explain indicate." }];
    const withDelay = (async () =>
      Response.json(
        {
          error: {
            status: "RESOURCE_EXHAUSTED",
            details: [{ reason: "RATE_LIMIT_EXCEEDED", retryDelay: "17s" }],
          },
        },
        { status: 429 },
      )) as unknown as typeof fetch;
    await expect(
      generateChatReply({ messages }, config, undefined, withDelay),
    ).rejects.toMatchObject({
      code: "AI_QUOTA_EXCEEDED",
      message: expect.stringContaining("17 saniye"),
    });
    resetGeminiKeyPool();
    const withHeader = (async () =>
      new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "42" },
      })) as unknown as typeof fetch;
    await expect(
      generateChatReply({ messages }, config, undefined, withHeader),
    ).rejects.toMatchObject({
      code: "AI_QUOTA_EXCEEDED",
      message: expect.stringContaining("42 saniye"),
    });
  });
  test("chat distinguishes provider network failures from cancellation", async () => {
    const messages = [{ role: "user" as const, content: "Explain indicate." }];
    const fetcher = (async () => {
      throw new Error("network secret");
    }) as unknown as typeof fetch;
    await expect(generateChatReply({ messages }, config, undefined, fetcher)).rejects.toMatchObject(
      {
        code: "AI_NETWORK_ERROR",
      },
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      generateChatReply({ messages }, config, controller.signal, fetcher),
    ).rejects.toMatchObject({ code: "AI_CANCELLED" });
  });
  test("chat recognizes invalid API keys returned as HTTP 400", async () => {
    const fetcher = (async () =>
      Response.json(
        { error: { details: [{ reason: "API_KEY_INVALID" }] } },
        { status: 400 },
      )) as unknown as typeof fetch;
    await expect(
      generateChatReply(
        { messages: [{ role: "user", content: "Hello" }] },
        config,
        undefined,
        fetcher,
      ),
    ).rejects.toMatchObject({ code: "AI_AUTH_ERROR" });
  });
  test("dictionary adapter uses only attributable Wiktionary data and at most two examples", async () => {
    const fetcher = (async () => Response.json(dictionaryEntry)) as unknown as typeof fetch;
    const source = await lookupDictionaryWord("Expand", undefined, fetcher);
    expect(source?.provider).toBe("DictionaryAPI.dev");
    expect(source?.licenseName).toBe("CC BY-SA 3.0");
    expect(source?.examples).toHaveLength(2);
    const unlicensed = (async () =>
      Response.json([{ ...dictionaryEntry[0], license: undefined }])) as unknown as typeof fetch;
    expect(await lookupDictionaryWord("Expand", undefined, unlicensed)).toBeUndefined();
  });
  test("enrichment passes dictionary hints to Gemini and returns verified attribution metadata", async () => {
    let geminiBody = "";
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("dictionaryapi.dev")) return Response.json(dictionaryEntry);
      geminiBody = String(init?.body);
      return upstream(suggestion);
    }) as typeof fetch;
    const result = await generateEnrichedWord("Expand", config, undefined, fetcher, fetcher);
    expect(JSON.parse(geminiBody).contents[0].parts[0].text).toContain(
      "We expand the project each year.",
    );
    expect(result.dictionarySource?.sourceUrl).toBe("https://en.wiktionary.org/wiki/expand");
    expect(result.suggestion.examples).toHaveLength(5);
  });
  test("named completion rejects a model response for a different headword", async () => {
    const fetcher = (async () =>
      upstream({ suggestions: [suggestion] })) as unknown as typeof fetch;
    expect(
      (await generateNamedWords(["Expand"], config, undefined, fetcher)).suggestions,
    ).toHaveLength(1);
    await expect(generateNamedWords(["Improve"], config, undefined, fetcher)).rejects.toMatchObject(
      { code: "AI_INVALID_RESPONSE" },
    );
  });
  test("list generation filters duplicates and rejects invalid words", async () => {
    const fetcher = (value: unknown) => (async () => upstream(value)) as unknown as typeof fetch;

    const result = await generateWordList(
      1,
      [],
      config,
      undefined,
      fetcher({ suggestions: [suggestion] }),
    );
    expect(result.suggestions).toHaveLength(1);

    // Excluded words must never be accepted.
    await expect(
      generateWordList(1, ["expand"], config, undefined, fetcher({ suggestions: [suggestion] })),
    ).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" });

    // A duplicate is removed, but the valid entry is preserved.
    let attempts = 0;
    const duplicateFetcher = (async () => {
      attempts++;
      return upstream({ suggestions: [suggestion, suggestion] });
    }) as unknown as typeof fetch;

    const partial = await generateWordList(2, [], config, undefined, duplicateFetcher);
    expect(partial.suggestions.map((item) => item.word)).toEqual([suggestion.word]);
    expect(attempts).toBe(2);

    // Invalid example sentences must not be accepted.
    await expect(
      generateWordList(
        1,
        [],
        config,
        undefined,
        fetcher({
          suggestions: [
            {
              ...suggestion,
              examples: Array(5).fill(suggestion.examples[0]),
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" });
  });
  test("uses server headers, schema-constrained JSON, and validates bilingual examples", async () => {
    let input: RequestInit | undefined;
    const fetcher = (async (_url: unknown, init: RequestInit) => {
      input = init;
      return upstream(suggestion);
    }) as unknown as typeof fetch;
    const result = await generateWord("Expand", config, undefined, fetcher);
    expect(result.suggestion.examples).toHaveLength(5);
    assert(input);
    expect(new Headers(input.headers).get("x-goog-api-key")).toBe("test-secret-never-return");
    expect(JSON.parse(input.body as string).generationConfig.responseMimeType).toBe(
      "application/json",
    );
    expect(JSON.parse(input.body as string).generationConfig.temperature).toBeUndefined();
  });
  test("word and list generation lower Gemini 3 thinking so JSON output is not truncated", async () => {
    const wordConfig = { ...config, GEMINI_MODEL_WORD: "gemini-3.8-flash" };
    let wordBody = "";
    const fetcher = (async (_url: unknown, init: RequestInit) => {
      wordBody = String(init.body);
      return upstream(suggestion);
    }) as unknown as typeof fetch;
    await generateWord("Expand", wordConfig, undefined, fetcher);
    expect(JSON.parse(wordBody).generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
    let listBody = "";
    const listFetcher = (async (_url: unknown, init: RequestInit) => {
      listBody = String(init.body);
      return upstream({ suggestions: [suggestion] });
    }) as unknown as typeof fetch;
    await generateWordList(1, [], wordConfig, undefined, listFetcher);
    expect(JSON.parse(listBody).generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
  });
  test("Flash-Lite keeps its minimal default thinking and does not spend output budget", async () => {
    let requestBody = "";
    let url = "";
    const fetcher = (async (input: unknown, init: RequestInit) => {
      url = String(input);
      requestBody = String(init.body);
      return upstream(suggestion);
    }) as unknown as typeof fetch;
    await generateWord("Expand", config, undefined, fetcher);
    expect(url).toContain("/models/gemini-3.5-flash-lite:generateContent");
    expect(JSON.parse(requestBody).generationConfig.thinkingConfig).toBeUndefined();
  });
  test("chat uses Gemini 3.5 Flash-Lite by default", async () => {
    let url = "";
    const fetcher = (async (input: unknown) => {
      url = String(input);
      return Response.json({
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Hello" }] } }],
      });
    }) as unknown as typeof fetch;
    const result = await generateChatReply(
      { messages: [{ role: "user", content: "Hello" }] },
      config,
      undefined,
      fetcher,
    );
    expect(url).toContain("/models/gemini-3.5-flash-lite:generateContent");
    expect(result.model).toBe("gemini-3.5-flash-lite");
  });
  test("does not send thinking levels to Gemini 2.5 word generation", async () => {
    let requestBody = "";
    const fetcher = (async (_url: unknown, init: RequestInit) => {
      requestBody = String(init.body);
      return upstream(suggestion);
    }) as unknown as typeof fetch;
    await generateWord(
      "Expand",
      { ...config, GEMINI_MODEL_WORD: "gemini-2.5-flash" },
      undefined,
      fetcher,
    );
    expect(JSON.parse(requestBody).generationConfig.thinkingConfig).toBeUndefined();
  });
  test("a 429 parks the operation across all five keys, other projects and models", async () => {
    const pooled = readConfig({
      GEMINI_API_KEYS: "project-a-key,project-b-key,key-c,key-d,key-e",
      GEMINI_KEY_PROJECT_GROUPS: "one,two,three,four,five",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "test-public",
    });
    const used: string[] = [];
    const fetcher = (async (_url: unknown, init: RequestInit) => {
      const key = new Headers(init.headers).get("x-goog-api-key");
      assert(key);
      used.push(key);
      if (key === "project-a-key")
        return Response.json(
          {
            error: {
              status: "RESOURCE_EXHAUSTED",
              details: [{ reason: "RATE_LIMIT_EXCEEDED", retryDelay: "17s" }],
            },
          },
          { status: 429 },
        );
      return upstream(suggestion);
    }) as unknown as typeof fetch;

    await expect(generateWord("Expand", pooled, undefined, fetcher)).rejects.toMatchObject({
      code: "AI_QUOTA_EXCEEDED",
      retryAfterSeconds: 17,
    });
    await expect(
      generateWord("Expand", { ...pooled, GEMINI_MODEL_WORD: "gemini-other" }, undefined, fetcher),
    ).rejects.toMatchObject({ code: "AI_QUOTA_EXCEEDED" });
    expect(used).toEqual(["project-a-key"]);
  });
  test("honors the advertised wait without additional attempts", async () => {
    const pooled = readConfig({
      GEMINI_API_KEYS: "limit-a,limit-b",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "test-public",
    });
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return Response.json(
        {
          error: {
            status: "RESOURCE_EXHAUSTED",
            details: [{ reason: "RATE_LIMIT_EXCEEDED", retryDelay: calls === 1 ? "17s" : "25s" }],
          },
        },
        { status: 429 },
      );
    }) as unknown as typeof fetch;

    await expect(generateWord("Expand", pooled, undefined, fetcher)).rejects.toMatchObject({
      code: "AI_QUOTA_EXCEEDED",
      message: expect.stringContaining("17 saniye"),
    });
    expect(calls).toBe(1);

    await expect(generateWord("Expand", pooled, undefined, fetcher)).rejects.toMatchObject({
      code: "AI_QUOTA_EXCEEDED",
    });
    expect(calls).toBe(1);
  });
  test("falls through a rejected key and follows the rotating key order", async () => {
    const pooled = readConfig({
      GEMINI_API_KEYS: "rejected-key,working-key",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "test-public",
    });
    const used: string[] = [];
    const fetcher = (async (_url: unknown, init: RequestInit) => {
      const key = new Headers(init.headers).get("x-goog-api-key");
      assert(key);
      used.push(key);
      if (key === "rejected-key")
        return Response.json(
          { error: { status: "PERMISSION_DENIED", details: [{ reason: "API_KEY_INVALID" }] } },
          { status: 400 },
        );
      return upstream(suggestion);
    }) as unknown as typeof fetch;

    const result = await generateWord("Expand", pooled, undefined, fetcher);
    expect(result.suggestion.word).toBe("Expand");
    expect(used).toEqual(["rejected-key", "working-key"]);
  });
  test("configuration pools unique keys and defaults each workload to its own model", () => {
    const pooled = readConfig({ GEMINI_API_KEYS: "alpha, beta\ngamma", GEMINI_API_KEY: "beta" });
    expect(pooled.GEMINI_KEYS).toEqual(["alpha", "beta", "gamma"]);
    const defaults = readConfig({});
    expect(defaults.GEMINI_MODEL_WORD).toBe("gemini-3.5-flash-lite");
    expect(defaults.GEMINI_MODEL_CHAT).toBe("gemini-3.5-flash-lite");
  });
  test("falls back to plain JSON when Gemini rejects structured output", async () => {
    const bodies: string[] = [];
    const fetcher = (async (_url: unknown, init: RequestInit) => {
      bodies.push(String(init.body));
      if (bodies.length === 1)
        return Response.json(
          { error: { status: "INVALID_ARGUMENT", details: [{ reason: "INVALID_ARGUMENT" }] } },
          { status: 400 },
        );
      return Response.json({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: "```json\n" + JSON.stringify(suggestion) + "\n```" }] },
          },
        ],
      });
    }) as unknown as typeof fetch;
    const result = await generateWord(
      "Expand",
      { ...config, GEMINI_MODEL_WORD: "gemini-3.8-flash" },
      undefined,
      fetcher,
    );
    expect(result.suggestion.word).toBe("Expand");
    expect(JSON.parse(bodies[0]).generationConfig.responseJsonSchema).toBeDefined();
    const fallbackConfig = JSON.parse(bodies[1]).generationConfig;
    expect(fallbackConfig.responseJsonSchema).toBeUndefined();
    expect(fallbackConfig.responseMimeType).toBeUndefined();
    expect(fallbackConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
  });
  test("accepts regular inflected example forms when alternatives omit them", async () => {
    const results = await generateWord("Expand", config, undefined, (async () =>
      upstream({
        ...suggestion,
        alternatives: [],
        examples: ["expanded", "expanding", "expands", "expand", "expanded"].map((form, index) => ({
          sentence: `We ${form} the project in year ${index}.`,
          translation: `Projeyi ${index}. yÄ±lda geniÅŸletiriz.`,
          translationFocus: ["geniÅŸletiriz"],
        })),
      })) as unknown as typeof fetch);
    expect(results.suggestion.examples).toHaveLength(5);
  });
  test("word validation logs only the failure stage and safe finish reason", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const fetcher = (async () =>
        upstream({ privateText: "secret input" })) as unknown as typeof fetch;
      await expect(generateWord("Expand", config, undefined, fetcher)).rejects.toMatchObject({
        code: "AI_INVALID_RESPONSE",
      });
      expect(log).toHaveBeenCalledWith({
        service: "gemini-word",
        validationStage: "schema",
        finishReason: "STOP",
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret input");
      expect(JSON.stringify(log.mock.calls)).not.toContain("Expand");
    } finally {
      log.mockRestore();
    }
  });
  test("rejects malformed, wrong-headword, truncated and ungrounded focus responses", async () => {
    for (const value of [
      {},
      { ...suggestion, word: "Other" },
      {
        ...suggestion,
        examples: suggestion.examples.map((example) => ({
          ...example,
          translationFocus: ["not present"],
        })),
      },
      {
        ...suggestion,
        examples: suggestion.examples.map((example) => ({
          ...example,
          sentence: "No related word here.",
        })),
      },
    ]) {
      await expect(
        generateWord("Expand", config, undefined, (async () =>
          upstream(value)) as unknown as typeof fetch),
      ).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" });
    }
    await expect(
      generateWord("Expand", config, undefined, (async () =>
        upstream(suggestion, "MAX_TOKENS")) as unknown as typeof fetch),
    ).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" });
  });
  test("maps quota, upstream failures and aborts to safe errors", async () => {
    for (const status of [429, 500]) {
      resetGeminiKeyPool();
      await expect(
        generateWord(
          "Expand",
          config,
          undefined,
          (async () => new Response("secret", { status })) as unknown as typeof fetch,
        ),
      ).rejects.toBeInstanceOf(HttpError);
    }
    resetGeminiKeyPool();
    const failing = (async () => {
      throw new Error("network secret");
    }) as unknown as typeof fetch;
    await expect(generateWord("Expand", config, undefined, failing)).rejects.toMatchObject({
      code: "AI_NETWORK_ERROR",
    });
    const controller = new AbortController();
    controller.abort();
    await expect(generateWord("Expand", config, controller.signal, failing)).rejects.toMatchObject({
      code: "AI_CANCELLED",
    });
  });
});
