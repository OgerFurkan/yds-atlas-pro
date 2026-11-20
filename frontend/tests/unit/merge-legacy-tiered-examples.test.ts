import { expect, test } from "bun:test";
import type { WordEntry, WordInput } from "@yds-atlas/shared";
import { mergeLegacyTieredExamples } from "@/features/word-library/model/merge-legacy-tiered-examples";
import { hasAtlasTiers } from "@/features/word-library/model/tiered-examples";

const tiers = ["easy", "easy", "medium", "yds", "yds"] as const;
const existing: WordEntry = {
 id: "record-1", word: "Deteriorate", meanings: ["kötüleşmek"],
 partOfSpeech: "Verb", cefr: "B2", usageNote: "Kullanıcı notu",
 score: 65, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-02T00:00:00Z",
 alternatives: ["deteriorating"], pronunciationUk: "", pronunciationUs: "", sourceUrl: "",
 examples: [{ sentence: "Old buildings deteriorate quickly.", translation: "Eski binalar hızla kötüleşir.",
 translationFocus: ["kötüleşir"], source: "Kullanıcı" }],
};
const generated: WordInput = {
 word: "deteriorate",
 examples: tiers.map((difficulty, index) => ({
  difficulty, sentence: "Conditions deteriorate as a consequence " + (index + 1) + ".",
  translation: "Koşullar " + (index + 1) + ". sonuç nedeniyle kötüleşir.",
  translationFocus: ["kötüleşir"], source: "Gemini test",
 })),
};
test("legacy 2/1/2 merge keeps original examples, user score and meanings", () => {
 const merged = mergeLegacyTieredExamples(existing, generated);
 expect(hasAtlasTiers(merged.examples)).toBe(true);
 expect(merged.examples).toHaveLength(6);
 expect(merged.examples?.[5]?.source).toBe("Kullanıcı");
 expect(merged.score).toBe(65);
 expect(merged.meanings).toEqual(["kötüleşmek"]);
 expect(merged.usageNote).toBe("Kullanıcı notu");
 expect(existing.examples).toHaveLength(1);
});
test("wrong word, incomplete tiers or shared-lexicon bound entry fail closed", () => {
 expect(() => mergeLegacyTieredExamples(existing, { ...generated, word:"unrelated" })).toThrow();
 expect(() => mergeLegacyTieredExamples(existing, { ...generated, examples:generated.examples?.slice(0,4)})).toThrow();
 expect(() => mergeLegacyTieredExamples({ ...existing, lexicon: {
  entryId:"550e8400-e29b-41d4-a716-446655440000", revision:1, contractVersion:1,
 } },generated)).toThrow();
});

test("85 independent legacy words retain their 425 original examples and all scores", () => {
  // Synthetic records only: this test never reads or writes a personal account.
  const rows = Array.from({ length: 85 }, (_, index): WordEntry => ({
    ...existing,
    id: "legacy-" + index,
    word: "Atlasword" + index,
    score: index,
    examples: Array.from({ length: 5 }, (_, oldIndex) => ({
      sentence: "The atlasword" + index + " was already in example " + oldIndex + ".",
      translation: "Kullanıcı tarafından korunacak önceki örnek " + oldIndex + ".",
      translationFocus: ["korunacak"],
      source: "Kullanıcı",
    })),
  }));
  const before = JSON.stringify(rows);
  const updated = rows.map((row, index) => mergeLegacyTieredExamples(row, {
    word: row.word,
    examples: tiers.map((difficulty, tier) => ({
      difficulty,
      sentence: "Students study " + row.word.toLowerCase() + " in new context " + tier + ".",
      translation: "Öğrenciler yeni bağlam " + tier + " içinde sözcüğü inceler.",
      translationFocus: ["inceler"],
      source: "Gemini test",
    })),
  }));
  expect(updated).toHaveLength(85);
  let preservedOriginalExamples = 0;
  for (const [index, next] of updated.entries()) {
    expect(hasAtlasTiers(next.examples)).toBe(true);
    expect(next.score).toBe(index);
    expect(next.meanings).toEqual(["kötüleşmek"]);
    expect(next.examples).toHaveLength(10);
    expect(next.examples?.slice(0, 5).map(example => example.difficulty)).toEqual(tiers);
    expect(next.examples?.slice(5)).toEqual(rows[index].examples);
    preservedOriginalExamples += next.examples!.slice(5).length;
  }
  expect(preservedOriginalExamples).toBe(425);
  expect(JSON.stringify(rows)).toBe(before);
});
