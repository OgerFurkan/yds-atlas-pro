import { expect, test } from "bun:test";
import type { AiWordListResponse } from "@yds-atlas/shared";
import type { ServerConfig } from "../src/config/env";
import { generateWordList } from "../src/features/ai/gemini";

// All fixtures are synthetic. No real Gemini, database, secret or student data.
const WORDS = ["alpha", "bravo", "charlie", "delta", "echo"];
const TIERS = ["easy", "easy", "medium", "yds", "yds"] as const;
function item(word: string): AiWordListResponse["suggestions"][number] {
  return {
    word, alternatives: [], meanings: ["kavram"],
    partOfSpeech: "Noun", cefr: "B1", usageNote: "Yalnızca sentetik test.",
    examples: TIERS.map((difficulty, index) => ({
      sentence: "Researchers discuss " + word + " in example " + (index + 1) + ".",
      translation: "Araştırmacılar " + (index + 1) + ". örnekte kelimeyi tartışıyor.",
      translationFocus: ["kelimeyi"], difficulty,
    })),
  };
}
function config(id: string): ServerConfig {
  return { GEMINI_KEYS: [id], GEMINI_MODEL_WORD: "gemini-3.5-flash-lite" } as ServerConfig;
}
function upstream(text: string, finishReason = "STOP"): Response {
  return Response.json({ candidates: [{ finishReason, content: { parts: [{ text }] } }] });
}
function outgoing(init?: RequestInit) {
  const body = JSON.parse(String(init?.body));
  return {
    structured: Object.hasOwn(body.generationConfig, "responseJsonSchema"),
    payload: JSON.parse(body.contents[0].parts[0].text) as { count: number; requested?: string[] },
  };
}
function validated(words: string[]) {
  return JSON.stringify({ suggestions: words.map(item) });
}
test("P0 regression: malformed structured five-item envelope triggers one compact plain retry", async () => {
  const calls: { structured: boolean; count: number; requested?: string[] }[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    const call = outgoing(init);
    calls.push({ structured: call.structured, count: call.payload.count, requested: call.payload.requested });
    return upstream(call.structured ? '{"suggestions": {' : validated(call.payload.requested ?? []));
  }) as typeof fetch;
  const result = await generateWordList(5, [], config("p0-a"), undefined, fetcher, WORDS);
  expect(calls).toEqual([
    { structured: true, count: 5, requested: WORDS },
    { structured: false, count: 2, requested: WORDS.slice(0, 2) },
  ]);
  expect(result.suggestions.map((word) => word.word)).toEqual(WORDS.slice(0, 2));
  expect(result.suggestions.every((word) =>
    word.examples.map((example) => example.difficulty).join() === "easy,easy,medium,yds,yds")).toBe(true);
});
test("MAX_TOKENS fails closed on the first pass and compact retry salvages safe words", async () => {
  const counts: number[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    const call = outgoing(init);
    counts.push(call.payload.count);
    return counts.length === 1 ? upstream('{"suggestions": [', "MAX_TOKENS") :
      upstream(validated(call.payload.requested ?? []));
  }) as typeof fetch;
  const result = await generateWordList(5, [], config("p0-b"), undefined, fetcher, WORDS);
  expect(counts).toEqual([5, 2]);
  expect(result.suggestions.map((word) => word.word)).toEqual(WORDS.slice(0, 2));
});
test("malformed and truncated envelopes across both passes still produce 502 and no words", async () => {
  const counts: number[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    counts.push(outgoing(init).payload.count);
    return upstream(counts.length === 1 ? '{"suggestions":' : '{"suggestions":{"wrong":true}}');
  }) as typeof fetch;
  await expect(generateWordList(5, [], config("p0-c"), undefined, fetcher, WORDS))
    .rejects.toMatchObject({ code: "AI_INVALID_RESPONSE", status: 502 });
  expect(counts).toEqual([5, 2]);
});
test("safety and recitation finishes stop immediately rather than bypassing restrictions", async () => {
  for (const reason of ["SAFETY", "RECITATION"]) {
    let calls = 0;
    const fetcher = (async () => { calls++; return upstream('{"suggestions":[]}', reason); }) as typeof fetch;
    await expect(generateWordList(5, [], config("p0-safe-" + reason), undefined, fetcher, WORDS))
      .rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" });
    expect(calls).toBe(1);
  }
});
test("foreign, malformed, duplicate and wrong translationFocus never become accepted words", async () => {
  let callCount = 0;
  const wrongFocus = item("charlie");
  wrongFocus.examples[0].translationFocus = ["bulunmayan"];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    const params = outgoing(init).payload;
    callCount++;
    return callCount === 1
      ? upstream(JSON.stringify({ suggestions: [
          item("alpha"), { word: "bravo" }, item("outside"), item("alpha"), wrongFocus,
        ] }))
      : upstream(validated(params.requested ?? []));
  }) as typeof fetch;
  const result = await generateWordList(5, [], config("p0-d"), undefined, fetcher, WORDS);
  expect(callCount).toBe(2);
  expect(result.suggestions.map((word) => word.word)).toEqual(WORDS);
  expect(result.suggestions.every((word) => word.examples.every((example) =>
    example.translationFocus.every((focus) => example.translation.includes(focus))))).toBe(true);
});
test("bad individual entries in both passes preserve only validated neighbors", async () => {
  let count = 0;
  const fetcher = (async () => {
    count++;
    const suggestions = count === 1
      ? [item("alpha"), { word: "bravo" }, item("foreign"), { word: "charlie" }, item("alpha")]
      : [{ word: "bravo" }, { word: "charlie" }, { word: "delta" }, { word: "echo" }];
    return upstream(JSON.stringify({ suggestions }));
  }) as typeof fetch;
  const result = await generateWordList(5, [], config("p0-e"), undefined, fetcher, WORDS);
  expect(result.suggestions.map((word) => word.word)).toEqual(["alpha"]);
  expect(count).toBe(2);
});
test("structured HTTP 400 still falls back to plain output without weakening validation", async () => {
  const structured: boolean[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    const next = outgoing(init);
    structured.push(next.structured);
    return next.structured
      ? Response.json({ error: { status: "INVALID_ARGUMENT" } }, { status: 400 })
      : upstream(validated(next.payload.requested ?? []));
  }) as typeof fetch;
  const result = await generateWordList(5, [], config("p0-f"), undefined, fetcher, WORDS);
  expect(structured).toEqual([true, false]);
  expect(result.suggestions).toHaveLength(5);
});
test("non-thought fenced JSON is parsed; thought text is not interpreted as content", async () => {
  const fence = String.fromCharCode(96, 96, 96);
  const fetcher = (async () => Response.json({
    candidates: [{ finishReason: "STOP", content: { parts: [
      { thought: true, text: "not user-facing JSON" },
      { text: fence + "json\n" + validated(WORDS) + "\n" + fence },
    ] } }],
  })) as typeof fetch;
  const result = await generateWordList(5, [], config("p0-g"), undefined, fetcher, WORDS);
  expect(result.suggestions.map((word) => word.word)).toEqual(WORDS);
});
test.each([
  [429, "AI_QUOTA_EXCEEDED"],
  [401, "AI_AUTH_ERROR"],
  [403, "AI_AUTH_ERROR"],
] as const)("HTTP %i keeps its real terminal error, not a false malformed-output 502", async (status, code) => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return Response.json({ error: { status: "upstream_test" } }, { status });
  }) as typeof fetch;
  await expect(generateWordList(5, [], config("p0-status-" + status), undefined, fetcher, WORDS))
    .rejects.toMatchObject({ code });
  expect(calls).toBe(1);
});
test("a pre-aborted request neither contacts the provider nor returns partial words", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const fetcher = (async () => { calls++; return upstream(validated(WORDS)); }) as typeof fetch;
  await expect(generateWordList(5, [], config("p0-abort"), controller.signal, fetcher, WORDS))
    .rejects.toMatchObject({ code: "AI_CANCELLED" });
  expect(calls).toBe(0);
});
