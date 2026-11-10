import { expect, test } from "bun:test";
import type { WordEntry } from "@yds-atlas/shared";
import {
  filterWords,
  toggleSelection,
  toggleVisibleSelection,
  wordCounts,
} from "@/features/word-library/model/word-library-view";

function word(
  value: string,
  score: number,
  updatedAt: string,
  cefr: WordEntry["cefr"] = "B1",
): WordEntry {
  return {
    id: value.toLowerCase(),
    word: value,
    alternatives: [],
    meanings: [`${value} anlamı`],
    usageNote: "",
    partOfSpeech: "",
    cefr,
    score,
    examples: [],
    pronunciationUk: "",
    pronunciationUs: "",
    sourceUrl: "",
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt,
  };
}

const words = [
  word("Abandon", 10, "2026-11-01T00:00:00Z", "B2"),
  word("Benefit", 50, "2026-11-03T00:00:00Z", "B1"),
  word("Decline", 90, "2026-11-02T00:00:00Z", "C1"),
];

test("word counts follow the shared score groups", () => {
  expect(wordCounts(words)).toEqual({ all: 3, hard: 1, review: 1, learned: 1 });
});

test("filters combine group, level and search", () => {
  const filters = {
    group: "review" as const,
    level: "all" as const,
    search: "",
    sort: "recent" as const,
  };
  expect(filterWords(words, filters).map((item) => item.word)).toEqual(["Benefit"]);
  expect(
    filterWords(words, { ...filters, group: "all", search: "anlamı" }).map((item) => item.word),
  ).toHaveLength(3);
  expect(
    filterWords(words, { ...filters, group: "all", level: "C1" }).map((item) => item.word),
  ).toEqual(["Decline"]);
});

test("sort modes keep the expected order", () => {
  const base = { group: "all" as const, level: "all" as const, search: "" };
  expect(filterWords(words, { ...base, sort: "recent" }).map((item) => item.word)).toEqual([
    "Benefit",
    "Decline",
    "Abandon",
  ]);
  expect(filterWords(words, { ...base, sort: "alphabetical" }).map((item) => item.word)).toEqual([
    "Abandon",
    "Benefit",
    "Decline",
  ]);
  expect(filterWords(words, { ...base, sort: "score" }).map((item) => item.word)).toEqual([
    "Decline",
    "Benefit",
    "Abandon",
  ]);
});

test("selection toggles single rows and the visible set", () => {
  expect(toggleSelection([], "a")).toEqual(["a"]);
  expect(toggleSelection(["a"], "a")).toEqual([]);
  expect(toggleVisibleSelection(["a"], ["a", "b"])).toEqual(["a", "b"]);
  expect(toggleVisibleSelection(["a", "b"], ["a", "b"])).toEqual([]);
  expect(toggleVisibleSelection(["c", "a"], ["a", "b"])).toEqual(["c", "a", "b"]);
});
