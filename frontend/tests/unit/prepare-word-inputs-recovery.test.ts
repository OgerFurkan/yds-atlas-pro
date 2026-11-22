import { expect, test } from "bun:test";
import type { AiWordListResponse, WordInput } from "@yds-atlas/shared";
import { prepareWordInputs } from "@/features/word-library/model/prepare-word-inputs";
import type { WordFillProgress } from "@/features/word-library/model/prepare-word-inputs";

// Synthetic headwords only; this test makes no HTTP calls and saves no user data.
const words = Array.from(
  { length: 20 },
  (_, index) => "atlasstage" + String.fromCharCode(97 + index),
);
const examples = (word: string) =>
  (["easy", "easy", "medium", "yds", "yds"] as const).map((difficulty, index) => ({
    sentence: `Researchers discuss ${word} in example ${index + 1}.`,
    translation: `Araştırmacılar ${index + 1}. örnekte alıştırmayı tartışır.`,
    translationFocus: ["alıştırmayı"],
    difficulty,
  }));
function suggestion(word: string): AiWordListResponse["suggestions"][number] {
  return {
    word,
    alternatives: [],
    meanings: ["alıştırma"],
    usageNote: "Yalnız sentetik sınama",
    partOfSpeech: "Noun",
    cefr: "B2",
    examples: examples(word),
  };
}
function response(group: string[]): AiWordListResponse {
  return { suggestions: group.map(suggestion), provider: "Gemini", model: "test-only" };
}

test("first five invalid AI words do not block the remaining 15 safe words", async () => {
  const groups: string[][] = [];
  const progress: WordFillProgress[] = [];
  const result = await prepareWordInputs(
    words.map((word): WordInput => ({ word })),
    [],
    async (group) => {
      groups.push(group);
      if (group[0] === words[0]) throw { status: 400, code: "AI_INVALID_RESPONSE" };
      return response(group);
    },
    (next) => progress.push(next),
  );
  expect(groups.map((group) => group.length)).toEqual([5, 5, 5, 5]);
  expect(result).toHaveLength(15);
  expect(result.map((item) => item.word)).toEqual(words.slice(5));
  expect(result.every((item) => item.examples?.length === 5)).toBe(true);
  expect(
    result.every(
      (item) => item.examples?.map((e) => e.difficulty).join() === "easy,easy,medium,yds,yds",
    ),
  ).toBe(true);
  expect(progress.at(-1)?.completed).toBe(15);
  expect(progress.at(-1)?.failedWords).toEqual(words.slice(0, 5));
});

test("all invalid groups fail closed and never return unvalidated placeholders", async () => {
  let calls = 0;
  await expect(
    prepareWordInputs(
      words.map((word): WordInput => ({ word })),
      [],
      async () => {
        calls++;
        throw { status: 400, code: "AI_INVALID_RESPONSE" };
      },
    ),
  ).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" });
  expect(calls).toBe(4);
});

test("quota exhaustion still stops without trying later groups", async () => {
  let calls = 0;
  await expect(
    prepareWordInputs(
      words.map((word): WordInput => ({ word })),
      [],
      async () => {
        calls++;
        throw { status: 429, retryAfterSeconds: 3600, code: "AI_QUOTA_EXCEEDED" };
      },
    ),
  ).rejects.toMatchObject({ code: "AI_QUOTA_EXCEEDED" });
  expect(calls).toBe(1);
});

test("a duplicate or foreign suggestion is not accepted as a requested word", async () => {
  const group = words.slice(0, 5);
  const result = await prepareWordInputs(
    group.map((word): WordInput => ({ word })),
    [],
    async () => ({
      suggestions: [suggestion(group[0]), suggestion(group[0]), suggestion("unrelated")],
      provider: "Gemini",
      model: "test-only",
    }),
  );
  expect(result.map((item) => item.word)).toEqual([group[0]]);
  expect(result[0].examples).toHaveLength(5);
});
