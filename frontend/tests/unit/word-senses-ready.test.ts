import { expect, test } from "bun:test";
import { wordInputSchema, type AiWordResponse, type WordPartOfSpeech, type WordEntry } from "@yds-atlas/shared";
import { getStudyReadiness, isGameReady } from "@/features/learning-game/model/game-engine";
import { setupCandidates } from "@/features/learning-game/model/game-setup";
import { starterVocabulary } from "@/features/word-library/data/starter-vocabulary";
import { combineWordSenses } from "@/features/word-library/model/combine-word-senses";

function word(score = 100): WordEntry {
  return { ...starterVocabulary[0], score, id: "word-1", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" };
}

test("a 100-point word with enough examples remains manually studyable", () => {
  const learned = word();
  expect(getStudyReadiness(learned).ready).toBe(true);
  expect(isGameReady(learned)).toBe(true);
  expect(setupCandidates([learned], "starter", [])).toHaveLength(0);
  expect(setupCandidates([learned], "library", [])).toHaveLength(1);
});

test("incomplete words are saved separately from game readiness with an exact example count", () => {
  const incomplete = { ...word(0), examples: word(0).examples.slice(0, 2) };
  expect(getStudyReadiness(incomplete)).toMatchObject({ ready: false, usable: 2, required: 5 });
  expect(isGameReady(incomplete)).toBe(false);
});

function response(partOfSpeech: WordPartOfSpeech, meaning: string): AiWordResponse {
  return {
    provider: "Gemini",
    model: "unit-test-model",
    suggestion: {
      word: "Exact",
      alternatives: [],
      partOfSpeech,
      meanings: [meaning],
      usageNote: `The ${partOfSpeech} sense of exact.`,
      cefr: "B2",
      examples: Array.from({ length: 5 }, (_, i) => ({
        sentence: `They use exact in context number ${i}.`,
        translation: `Tam sözcüğünü ${i}. bağlamda kullanırlar.`,
        translationFocus: ["Tam"],
      })),
    },
  };
}

test("requested grammatical senses remain independently stored under one headword", () => {
  const adjective = response("Adjective", "tam");
  const verb = response("Verb", "kesinleştirmek");
  const combined = wordInputSchema.parse(combineWordSenses([verb, adjective], ["Adjective", "Verb"], "Adjective"));
  expect(combined.word).toBe("Exact");
  expect(combined.partOfSpeech).toBe("Adjective");
  expect(combined.meanings).toEqual(["tam"]);
  expect(combined.senses).toHaveLength(2);
  expect(combined.senses.map((sense) => sense.partOfSpeech)).toEqual(["Verb", "Adjective"]);
  expect(combined.senses[0]?.meanings).toEqual(["kesinleştirmek"]);
});

test("unrequested and duplicate senses are never stored", () => {
  const adjective = response("Adjective", "tam");
  const verb = response("Verb", "kesinleştirmek");
  const one = wordInputSchema.parse(combineWordSenses([adjective, verb], ["Adjective"], "Adjective"));
  expect(one.senses).toHaveLength(1);
  expect(() => combineWordSenses([adjective, adjective], ["Adjective"])).toThrow();
  expect(() => combineWordSenses([adjective], [])).toThrow();
});
