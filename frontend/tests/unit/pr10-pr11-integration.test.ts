import { describe, expect, test } from "bun:test";
import { hasCompleteTierSet, wordExampleSchema, wordInputSchema } from "@yds-atlas/shared";
import { contextExamplesForPhase, selectContextExample } from "@/features/learning-game/model/context-examples";
import { restoreExampleMetadata } from "@/features/word-library/model/restore-example-metadata";
import { starterVocabulary } from "@/features/word-library/data/starter-vocabulary";
import { createSession, makeQuestion } from "@/features/learning-game/model/game-engine";

const graded = [
  { sentence: "We obtain books.", translation: "Kitapları elde ederiz.", difficulty: "easy" as const, purpose: "practice" as const },
  { sentence: "Students obtain results.", translation: "Öğrenciler sonuçları elde eder.", difficulty: "easy" as const, purpose: "practice" as const },
  { sentence: "They obtain reliable evidence.", translation: "Güvenilir kanıt elde ederler.", difficulty: "medium" as const, purpose: "practice" as const },
  { sentence: "Scientists sought to obtain sufficient evidence to justify the conclusion.", translation: "Bilim insanları sonucu doğrulamak için yeterli kanıt elde etmeye çalıştı.", difficulty: "yds" as const, purpose: "exam" as const },
  { sentence: "The committee failed to obtain an adequately representative set of observations.", translation: "Kurul yeterince temsili gözlem kümesini elde edemedi.", difficulty: "yds" as const, purpose: "exam" as const },
].map(item => wordExampleSchema.parse(item));

const selected = (final: boolean, attempt = 0, examples = graded) =>
  selectContextExample(examples, final, attempt, "stable-seed");

describe("PR10/PR11 integrated learning contract", () => {
  test("Zod preserves BOTH independent purpose and difficulty", () => {
    const output = wordExampleSchema.parse(graded[0]);
    expect(output.purpose).toBe("practice");
    expect(output.difficulty).toBe("easy");
    expect(wordExampleSchema.parse(JSON.parse(JSON.stringify(output)))).toEqual(output);
  });
  test("two dimensions survive a full word-input parse", () => {
    const word = wordInputSchema.parse({ word: "Obtain", meanings: ["elde etmek"], examples: graded });
    expect(word.examples.map(x => x.purpose)).toEqual(["practice", "practice", "practice", "exam", "exam"]);
    expect(word.examples.map(x => x.difficulty)).toEqual(["easy", "easy", "medium", "yds", "yds"]);
  });
  test("fully graded group starts medium then cycles two easy", () => {
    expect(hasCompleteTierSet(graded)).toBe(true);
    expect(selected(false, 0)).toMatchObject({ status: "selected", example: { difficulty: "medium" } });
    expect(selected(false, 1)).toMatchObject({ status: "selected", example: { difficulty: "easy" } });
    expect(selected(false, 2)).toMatchObject({ status: "selected", example: { difficulty: "easy" } });
    expect((selected(false, 1) as any).example.sentence).not.toBe((selected(false, 2) as any).example.sentence);
  });
  test("fully graded final never uses easy or medium", () => {
    for (let n = 0; n < 20; n++) expect(selected(true, n)).toMatchObject({ status: "selected", example: { difficulty: "yds" } });
  });
  test("graded example with contradictory purpose blocks both phases", () => {
    const wrong = graded.map((x, i) => i === 0 ? { ...x, purpose: "exam" as const } : x);
    expect(selectContextExample(wrong, false, 0, "x").status).toBe("missing");
    expect(selectContextExample(wrong, true, 0, "x").status).toBe("missing");
  });
  test("incomplete graded pool blocks rather than using ungraded fallback", () => {
    const partial = [...graded.slice(0, 4), { sentence: "I obtain this.", translation: "Bunu elde ederim." }];
    expect(selectContextExample(partial, true, 0, "x").status).toBe("missing");
  });
  test("personal extra sentences are preserved but not silently re-labeled", () => {
    const extra = { sentence: "I obtain novels.", translation: "Roman elde ederim.", source: "personal" };
    const input = [...graded, wordExampleSchema.parse(extra)];
    expect(selectContextExample(input, false, 0, "x")).toMatchObject({ status: "selected", example: { difficulty: "medium" } });
    expect(input.at(-1)?.source).toBe("personal");
    expect(input.at(-1)?.difficulty).toBeUndefined();
  });
  test("PR10 editorial purpose only filters starter group and final independently", () => {
    expect(starterVocabulary).toHaveLength(20);
    for (const word of starterVocabulary) {
      expect(word.examples.filter(x => x.purpose === "practice")).toHaveLength(2);
      expect(word.examples.filter(x => x.purpose === "exam")).toHaveLength(3);
      expect(word.examples.every(x => x.difficulty === undefined)).toBe(true);
      expect(selectContextExample(word.examples, false, 0, word.word)).toMatchObject({ status: "selected", example: { purpose: "practice" } });
      expect(selectContextExample(word.examples, true, 0, word.word)).toMatchObject({ status: "selected", example: { purpose: "exam" } });
    }
  });
  test("PR10 starter game questions keep intended group/final separation", () => {
    const first = starterVocabulary[0];
    const word = { ...first, id: "int-test-word", createdAt: "2026-11-16T00:00:00Z", updatedAt: "2026-11-16T00:00:00Z" };
    const session = { ...createSession([word], 5), phase: "context" as const };
    expect(makeQuestion(session)?.example?.purpose).toBe("practice");
    expect(makeQuestion({ ...session, phase: "final-context" })?.example?.purpose).toBe("exam");
  });
  test("opposite-only phase refuses to fabricate a question", () => {
    const practiceOnly = [{ sentence: "We obtain books.", translation: "Kitap alırız.", purpose: "practice" as const }];
    expect(contextExamplesForPhase(practiceOnly, true)).toEqual([]);
    expect(selectContextExample(practiceOnly, true, 0, "x").status).toBe("missing");
  });
  test("unlabeled old examples retain legacy classification", () => {
    const legacy = graded.map(({ purpose: _p, difficulty: _d, ...e }) => e);
    expect(selectContextExample(legacy, false, 0, "x").status).toBe("legacy");
    expect(selectContextExample(legacy, true, 0, "x").status).toBe("legacy");
  });
  test("editor exact edit preserves both dimensions and source metadata", () => {
    const originals = [{ ...graded[0], source: "Atlas", translationFocus: ["Kitapları"] }];
    const edited = [{ sentence: graded[0].sentence, translation: graded[0].translation }];
    expect(restoreExampleMetadata(edited, originals)[0]).toMatchObject({ purpose: "practice", difficulty: "easy", source: "Atlas", translationFocus: ["Kitapları"] });
  });
  test("editor rewritten sentence does not inherit calibrated labels", () => {
    const originals = [graded[0]];
    const edited = [{ sentence: "I independently obtain books.", translation: graded[0].translation }];
    expect(restoreExampleMetadata(edited, originals)[0].difficulty).toBeUndefined();
    expect(restoreExampleMetadata(edited, originals)[0].purpose).toBeUndefined();
  });
  test("ambiguous original duplicate never transfers metadata", () => {
    const originals = [graded[0], { ...graded[0], source: "conflicting" }];
    const edited = [{ sentence: graded[0].sentence, translation: graded[0].translation }];
    expect(restoreExampleMetadata(edited, originals)[0].difficulty).toBeUndefined();
  });
  test("invalid attempt does not select a staged example", () => {
    expect(selectContextExample(graded, false, -1, "x").status).toBe("missing");
    expect(selectContextExample(graded, false, NaN, "x").status).toBe("missing");
  });
});
