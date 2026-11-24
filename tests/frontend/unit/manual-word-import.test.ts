import { expect, test } from "bun:test";
import {
  needsAiMeaning,
  parseBulkWordEntries,
  splitWordInputsByMeaning,
} from "../../../frontend/src/features/word-library/model/manual-word-import";

test("mixed user-provided meanings and bare words preserve authored translations", () => {
  expect(parseBulkWordEntries("hello = merhaba\nbenefit\nrun = koşmak, çalışmak")).toEqual([
    { word: "Hello", meanings: ["merhaba"] },
    { word: "Benefit" },
    { word: "Run", meanings: ["koşmak", "çalışmak"] },
  ]);
});

test("legacy word-only comma and semicolon lists still work", () => {
  expect(parseBulkWordEntries("benefit, BENEFIT; abandon\nconsequence")).toEqual([
    { word: "Benefit" },
    { word: "Abandon" },
    { word: "Consequence" },
  ]);
});

test("meaningful duplicate wins over a bare word without losing user meaning", () => {
  expect(parseBulkWordEntries("hello\nHELLO = merhaba\nHello")).toEqual([
    { word: "Hello", meanings: ["merhaba"] },
  ]);
});

test("empty meanings remain clearly incomplete and invalid headwords are refused", () => {
  expect(parseBulkWordEntries("hello = \nworld")).toEqual([
    { word: "Hello", meanings: [] },
    { word: "World" },
  ]);
  expect(() => parseBulkWordEntries("= merhaba")).toThrow("İngilizce kelime");
  expect(() => parseBulkWordEntries("w".repeat(121))).toThrow("120");
});

test("only new words without meanings ask for AI; complete user meanings bypass it", () => {
  const entries = parseBulkWordEntries("hello = merhaba\nbenefit\nknown");
  const groups = splitWordInputsByMeaning(entries, [{ word: "Known" }]);
  expect(groups.direct.map((entry) => entry.word)).toEqual(["Hello", "Known"]);
  expect(groups.needsAi.map((entry) => entry.word)).toEqual(["Benefit"]);
  expect(needsAiMeaning({ word: "hello", meanings: ["merhaba"] })).toBe(false);
  expect(needsAiMeaning({ word: "hello", meanings: [] })).toBe(true);
});
