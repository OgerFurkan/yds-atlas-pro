import { expect, test } from "bun:test";
import type { WordEntry } from "@yds-atlas/shared";
import {
  alignChosenWords,
  selectTaskWords,
  setupCandidates,
  taskGroupCount,
} from "@/features/learning-game/model/game-setup";
import { starterVocabulary } from "@/features/word-library/data/starter-vocabulary";
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

test("starter candidates skip words already learned in the library", () => {
  const words = [stored(0, 90), stored(1, 20)];
  const candidates = setupCandidates(words, "starter", []);
  expect(candidates.some((word) => wordKey(word.word) === wordKey(words[0].word))).toBe(false);
  expect(candidates.some((word) => wordKey(word.word) === wordKey(words[1].word))).toBe(true);
  expect(candidates.length).toBe(starterVocabulary.length - 1);
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

function stagedWord(index: number): WordEntry {
  return { ...stored(index), examples: [] };
}
