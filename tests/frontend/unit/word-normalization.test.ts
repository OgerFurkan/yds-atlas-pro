import { expect, test } from "bun:test";
import {
  normalizeWord,
  parseWordList,
  wordKey,
} from "../../../frontend/src/features/word-library/model/word-normalization";
import { getWordGroup } from "../../../packages/shared/src/index";

test("headwords are capitalized, spaced and deduplicated consistently", () => {
  expect(normalizeWord("  ABANDON  ")).toBe("Abandon");
  expect(normalizeWord("look    after")).toBe("Look after");
  expect(normalizeWord("English")).toBe("English");
  expect(parseWordList("benefit, BENEFIT; abandon\n  abandon ")).toEqual(["Benefit", "Abandon"]);
  expect(wordKey("  Look  After ")).toBe("look after");
});

test("group boundaries are unambiguous", () => {
  expect([0, 39, 40, 79, 80, 100].map(getWordGroup)).toEqual([
    "hard",
    "hard",
    "review",
    "review",
    "learned",
    "learned",
  ]);
});
