import { expect, test } from "bun:test";
import type { WordEntry } from "@yds-atlas/shared";
import {
  alignChosenWords,
  selectTaskWords,
  setupCandidates,
  taskGroupCount,
} from "@/features/learning-game/model/game-setup";
import { aiSuggestionToWordInput } from "@/features/word-library/api/ai-word-api";
import { starterVocabulary } from "@/features/word-library/data/starter-vocabulary";
import { prepareWordInputs } from "@/features/word-library/model/prepare-word-inputs";
import { wordKey } from "@/features/word-library/model/word-normalization";

function stored(index: number, score = 0): WordEntry {
  return {
    ...starterVocabulary[index],
    id: `word-${index}`,
    score,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  };
}

test("ready list uses hard and review words from the library, excluding learned words", () => {
  const words = [stored(0, 90), stored(1, 20), stored(2, 50), stagedWord(3, 10)];
  const candidates = setupCandidates(words, "starter", []);
  expect(candidates.some((word) => wordKey(word.word) === wordKey(words[0].word))).toBe(false);
  expect(candidates.some((word) => wordKey(word.word) === wordKey(words[1].word))).toBe(true);
  expect(candidates.some((word) => wordKey(word.word) === wordKey(words[2].word))).toBe(true);
  expect(candidates.some((word) => wordKey(word.word) === wordKey(words[3].word))).toBe(false);
  expect(candidates).toHaveLength(2);
  expect(setupCandidates([], "starter", [])).toEqual([]);
});

test("ready-list task selection prioritizes hard words and fills from review words", () => {
  const candidates = [stored(0, 55), stored(1, 20), stored(2, 70), stored(3, 10)];
  const selected = selectTaskWords(candidates, 3, false, true);
  expect(selected).toHaveLength(3);
  expect(selected.slice(0, 2).every((word) => (word.score ?? 0) < 40)).toBe(true);
  expect(selected[2].score).toBeGreaterThanOrEqual(40);
});

test("library and own sources only contain ready words", () => {
  const words = [stored(0, 20), { ...stored(1, 20), examples: [] }, stored(2, 90)];
  expect(setupCandidates(words, "library", []).map((word) => word.id)).toEqual(["word-0"]);
  expect(
    setupCandidates(words, "own", [wordKey(words[0].word), wordKey(words[2].word)]).map(
      (word) => word.id,
    ),
  ).toEqual(["word-0"]);
});

test("task size helpers stay clamped to available words", () => {
  expect(taskGroupCount(20, 20, 5)).toBe(4);
  expect(taskGroupCount(20, 7, 10)).toBe(1);
  expect(taskGroupCount(0, 0, 5)).toBe(0);
  expect(
    selectTaskWords(
      starterVocabulary.map((_, index) => stored(index)),
      5,
    ),
  ).toHaveLength(5);
  expect(
    selectTaskWords(
      starterVocabulary.map((_, index) => stored(index)),
      5,
      true,
    ),
  ).toHaveLength(starterVocabulary.length);
});

test("chosen words are re-read from storage and must stay complete", () => {
  const words = [stored(0), stagedWord(1)];
  expect(alignChosenWords(words, words).map((word) => word.id)).toEqual(["word-0"]);
});

function stagedWord(index: number, score = 0): WordEntry {
  return { ...stored(index, score), examples: [] };
}

test("new inputs are completed in batches without overwriting user data or existing words", async () => {
  const calls: string[][] = [];
  const complete = async (words: string[]) => {
    calls.push(words);
    return {
      provider: "Gemini" as const,
      model: "test",
      suggestions: words.map((word) => ({
        word,
        alternatives: [],
        meanings: ["AI anlamı"],
        usageNote: "AI notu",
        partOfSpeech: "Verb" as const,
        cefr: "B2" as const,
        examples: Array.from({ length: 5 }, (_, index) => ({
          sentence: `We ${word} item ${index}.`,
          translation: `${index} öğesini ölçeriz.`,
          translationFocus: ["ölçeriz"],
        })),
      })),
    };
  };
  const result = await prepareWordInputs(
    [
      {
        word: "quantify",
        meanings: ["ölçmek"],
        score: 35,
        examples: [
          { sentence: "We quantify data.", translation: "Verileri ölçeriz.", source: "Kullanıcı" },
        ],
      },
      { word: "QUANTIFY" },
      { word: "existing" },
    ],
    [{ word: "Existing" }],
    complete,
  );
  expect(calls).toEqual([["QUANTIFY"]]);
  expect(result[0].meanings).toEqual(["ölçmek"]);
  expect(result[0].score).toBe(35);
  expect(result[0].examples[0].source).toBe("Kullanıcı");
  expect(result[0].examples).toHaveLength(6);
  expect(result[0].examples[1].source).toBe("Gemini · test");
  expect(result[2].examples).toHaveLength(0);
});

test("completion progress reports only words that need AI and advances per batch", async () => {
  const progress: { completed: number; total: number; batchSize: number }[] = [];
  const complete = async (words: string[]) => ({
    provider: "Gemini" as const,
    model: "test",
    suggestions: words.map((word) => ({
      word,
      alternatives: [],
      meanings: ["AI anlamı"],
      usageNote: "AI notu",
      partOfSpeech: "Verb" as const,
      cefr: "B2" as const,
      examples: Array.from({ length: 5 }, (_, index) => ({
        sentence: `We ${word} item ${index}.`,
        translation: `${index} öğesini ölçeriz.`,
        translationFocus: ["ölçeriz"],
      })),
    })),
  });
  const words = Array.from({ length: 12 }, (_, index) => ({ word: `probe${index}` }));
  await prepareWordInputs(words, [], complete, (next) => progress.push(next));
  expect(progress).toEqual([
    { completed: 0, total: 12, batchSize: 5 },
    { completed: 5, total: 12, batchSize: 5 },
    { completed: 10, total: 12, batchSize: 5 },
    { completed: 12, total: 12, batchSize: 5 },
  ]);
  const alreadyComplete: typeof progress = [];
  await prepareWordInputs([{ word: "existing" }], [{ word: "existing" }], complete, (next) =>
    alreadyComplete.push(next),
  );
  expect(alreadyComplete).toEqual([]);
});

test("completion failures and oversized batches do not produce partial results", async () => {
  let calls = 0;
  const fail = async () => {
    calls++;
    throw new Error("unavailable");
  };
  await expect(prepareWordInputs([{ word: "quantify" }], [], fail)).rejects.toThrow("unavailable");
  expect(calls).toBe(1);
  const words = Array.from({ length: 26 }, (_, index) => ({ word: `word${index}` }));
  await expect(prepareWordInputs(words, [], fail)).rejects.toThrow("25");
  expect(calls).toBe(1);
});

test("dictionary sentence attribution is exact and generated examples remain attributed to Gemini", () => {
  const dictionarySentence = "We expand the project each year.";
  const input = aiSuggestionToWordInput(
    {
      word: "Expand",
      alternatives: [],
      meanings: ["Genişlemek"],
      usageNote: "Boyut veya kapsamı artırmak.",
      partOfSpeech: "Verb",
      cefr: "B2",
      examples: Array.from({ length: 5 }, (_, index) => ({
        sentence: index === 0 ? dictionarySentence : `Teams expand their work in case ${index}.`,
        translation: `Ekipler ${index}. durumda çalışmalarını genişletir.`,
        translationFocus: ["genişletir"],
      })),
    },
    "test-model",
    {
      word: "Expand",
      provider: "DictionaryAPI.dev",
      sourceUrl: "https://en.wiktionary.org/wiki/expand",
      licenseName: "CC BY-SA 3.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
      definitions: ["To make larger."],
      examples: [{ sentence: dictionarySentence }],
    },
  );
  expect(input.examples[0].source).toContain("CC BY-SA 3.0");
  expect(input.examples[0].source).toContain("https://en.wiktionary.org/wiki/expand");
  expect(input.examples[1].source).toBe("Gemini · test-model");
  expect(input.sourceUrl).toBe("https://en.wiktionary.org/wiki/expand");
});
