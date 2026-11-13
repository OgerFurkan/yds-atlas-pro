import { expect, test } from "bun:test";
import { aiWordRequestSchema, wordInputSchema } from "@yds-atlas/shared";

test("AI enrichment accepts a specific grammatical category", () => {
  expect(aiWordRequestSchema.parse({ word: "Exact", partOfSpeech: "Adjective" }).partOfSpeech).toBe("Adjective");
  expect(aiWordRequestSchema.parse({ word: "Exact" }).word).toBe("Exact");
});

test("unsupported grammatical categories are rejected", () => {
  expect(aiWordRequestSchema.safeParse({ word: "Exact", partOfSpeech: "ImaginaryPart" }).success).toBe(false);
});

test("legacy word records continue to parse with no optional senses", () => {
  expect(wordInputSchema.parse({ word: "Exact" }).senses).toEqual([]);
});
