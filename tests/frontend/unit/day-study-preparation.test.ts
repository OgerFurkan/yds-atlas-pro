import { expect, test } from "bun:test";
import { mergeDayStudyWord } from "../../../frontend/src/features/word-library/model/day-study-preparation";
import { wordEntrySchema } from "../../../packages/shared/src/index";

const existing = wordEntrySchema.parse({
  id: "own",
  word: "Evidence",
  meanings: ["kanıt"],
  partOfSpeech: "Noun",
  score: 37,
  usageNote: "Kişisel not",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  examples: [{ sentence: "Evidence matters.", translation: "Kanıt önemli." }],
});
const candidate = {
  word: "Evidence",
  partOfSpeech: "Noun",
  meanings: ["Kanıt"],
  examples: (["easy", "easy", "medium", "yds", "yds"] as const).map((difficulty, index) => ({
    difficulty,
    sentence: `Evidence supports report ${index}.`,
    translation: "Kanıt raporu destekliyor.",
    translationFocus: ["Kanıt"],
  })),
};
test("day preparation adds matching examples while preserving personal details", () => {
  const prepared = mergeDayStudyWord(existing, candidate);
  expect(prepared).toMatchObject({
    meanings: existing.meanings,
    score: 37,
    usageNote: existing.usageNote,
  });
  expect(prepared?.examples).toHaveLength(6);
  expect(prepared?.examples?.at(-1)).toEqual(existing.examples[0]);
});
test("day preparation rejects wrong words, senses, untiered data and mismatched sentences", () => {
  expect(mergeDayStudyWord(existing, { ...candidate, meanings: ["farklı anlam"] })).toBeNull();
  expect(mergeDayStudyWord(existing, { ...candidate, word: "Benefit" })).toBeNull();
  expect(mergeDayStudyWord(existing, { ...candidate, partOfSpeech: "Verb" })).toBeNull();
  expect(
    mergeDayStudyWord(existing, { ...candidate, examples: candidate.examples.slice(0, 4) }),
  ).toBeNull();
  const invalid = candidate.examples.map((example) => ({
    ...example,
    sentence: example.sentence.replace("Evidence", "Benefit"),
  }));
  expect(mergeDayStudyWord(existing, { ...candidate, examples: invalid })).toBeNull();
});
