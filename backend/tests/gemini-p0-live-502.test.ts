import { expect, test } from "bun:test";
import type { AiWordListResponse } from "@yds-atlas/shared";
import type { ServerConfig } from "../src/config/env";
import { generateNamedWords } from "../src/features/ai/gemini";

const config = {
  GEMINI_KEYS: ["p0-synthetic"],
  GEMINI_MODEL_WORD: "gemini-3.5-flash-lite",
} as ServerConfig;
const words = Array.from({ length: 20 }, (_, i) => "atlas" + String.fromCharCode(97 + i));

function wordEntry(word: string): AiWordListResponse["suggestions"][number] {
  return {
    word,
    alternatives: [],
    meanings: ["kavram"],
    usageNote: "Sentetik test.",
    partOfSpeech: "Noun",
    cefr: "B1",
    examples: (["easy", "easy", "medium", "yds", "yds"] as const).map((difficulty, i) => ({
      sentence: `They discuss ${word} in example ${i + 1}.`,
      translation: `${i + 1}. örnekte kavramı tartışırlar.`,
      translationFocus: ["kavramı"],
      difficulty,
    })),
  };
}

function provider(content: (requested: string[]) => string) {
  const calls: string[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    const { generationConfig, contents } = JSON.parse(String(init?.body));
    const { requested } = JSON.parse(contents[0].parts[0].text);
    const schema = Object.hasOwn(generationConfig, "responseJsonSchema");
    const json = generationConfig.responseMimeType === "application/json";
    calls.push(schema ? "schema" : json ? "json" : "text");
    if (schema) return Response.json({ error: { status: "INVALID_ARGUMENT" } }, { status: 400 });
    const text = json ? content(requested) : "Unstructured response.";
    return Response.json({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }],
    });
  }) as typeof fetch;
  return { calls, fetcher };
}

const envelope = (group: string[]) => JSON.stringify({ suggestions: group.map(wordEntry) });

test("four five-word requests recover from a rejected schema and validate all twenty words", async () => {
  const { calls, fetcher } = provider(envelope);
  const recovered: string[] = [];
  for (let offset = 0; offset < words.length; offset += 5) {
    try {
      const result = await generateNamedWords(
        words.slice(offset, offset + 5),
        config,
        undefined,
        fetcher,
      );
      recovered.push(...result.suggestions.map((item) => item.word));
    } catch (error) {
      expect(error).toMatchObject({ status: 502, code: "AI_INVALID_RESPONSE" });
    }
  }
  expect(recovered).toEqual(words);
  expect(calls).toEqual(["schema", "json", "json", "json", "json"]);
});

test.each([
  ["invalid JSON", "{"],
  ["invalid envelope", '{"suggestions":{}}'],
  ["no valid entry", '{"suggestions":[{"word":"atlasa"}]}'],
] as const)("%s never starts a cooldown on HTTP 200", async (_label, invalid) => {
  let valid = false;
  const { calls, fetcher } = provider((group) => (valid ? envelope(group) : invalid));
  const generate = () => generateNamedWords(words.slice(0, 5), config, undefined, fetcher);
  await expect(generate()).rejects.toMatchObject({ status: 502, code: "AI_INVALID_RESPONSE" });
  expect(calls).toEqual(["schema", "json", "json"]);
  calls.length = 0;
  valid = true;
  expect((await generate()).suggestions).toHaveLength(5);
  expect(calls).toEqual(["schema", "json"]);
});

test("a validated partial fallback starts cooldown and requests only missing headwords", async () => {
  const groups: string[][] = [];
  const { calls, fetcher } = provider((group) => {
    groups.push(group);
    return envelope(groups.length === 1 ? group.slice(0, 2) : group);
  });
  const group = words.slice(0, 5);
  const result = await generateNamedWords(group, config, undefined, fetcher);
  expect(result.suggestions.map((item) => item.word)).toEqual(group);
  expect(groups).toEqual([group, group.slice(2)]);
  expect(calls).toEqual(["schema", "json", "json"]);
});
