import { expect, test } from "bun:test";
import { calculateStreak } from "@/features/dashboard/model/streak";
import { starterVocabulary } from "@/features/word-library/data/starter-vocabulary";

test("streak starts with completed goals and includes consecutive days", () => {
  const result = calculateStreak(["2026-11-08", "2026-11-09", "2026-11-10"], "2026-11-10");
  expect(result.current).toBe(3);
  expect(result.longest).toBe(3);
});
test("unfinished today retains yesterday's streak; a missed full day resets it", () => {
  expect(calculateStreak(["2026-11-08", "2026-11-09"], "2026-11-10").current).toBe(2);
  expect(calculateStreak(["2026-11-08"], "2026-11-10").current).toBe(0);
});
test("record streak survives gaps, duplicate dates and month boundaries", () => {
  const result = calculateStreak(
    ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-01", "2026-11-10"],
    "2026-11-10",
  );
  expect(result.current).toBe(1);
  expect(result.longest).toBe(3);
  expect(calculateStreak([], "2026-11-10").current).toBe(0);
});
test("all starter sentences include an editorial Turkish translation", () => {
  expect(starterVocabulary.flatMap((word) => word.examples)).toHaveLength(100);
  for (const word of starterVocabulary)
    for (const example of word.examples) expect(example.translation.length).toBeGreaterThan(10);
});

test("every starter translation marks the exact contextual Turkish form", () => {
  for (const word of starterVocabulary) {
    for (const example of word.examples) {
      expect(example.translationFocus?.length).toBeGreaterThan(0);
      for (const term of example.translationFocus ?? [])
        expect(example.translation).toContain(term);
    }
  }
  // The new first practice example teaches physical expansion.
  // The exam-intended third example retains expansion of a town.
  const expand = starterVocabulary.find((word) => word.word === "Expand");
  expect(expand?.examples[0]).toMatchObject({
    sentence: "Heat makes metals expand.",
    translation: "Isı metallerin genleşmesini sağlar.",
    translationFocus: ["genleşmesini"],
    purpose: "practice",
  });
  expect(expand?.examples[2]).toMatchObject({
    sentence: "The town began to expand as more people moved there.",
    translationFocus: ["genişlemeye"],
    purpose: "exam",
  });
});
