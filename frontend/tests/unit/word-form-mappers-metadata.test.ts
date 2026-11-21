import { expect, test } from "bun:test";
import { preserveExampleMetadata } from "@/features/word-library/model/word-form-mappers";

test("editing unchanged user examples preserves their validated difficulty and provenance", () => {
  const sentence = "The committee used a rigorous approach to the evaluation.";
  const translation = "Komite değerlendirmede titiz bir yaklaşım kullandı.";
  const source = {
    word: "Approach", score: 37, meanings: ["yaklaşım"],
    examples: [{
      sentence, translation, difficulty: "yds" as const,
      translationFocus: ["yaklaşım"], source: "Gemini · verified-model",
    }],
  };
  const draft = {
    word: "Approach", score: 37, meanings: ["yaklaşım"],
    examples: [{ sentence, translation }],
  };
  const saved = preserveExampleMetadata(draft, source);
  expect(saved.score).toBe(37);
  expect(saved.examples?.[0]).toMatchObject({
    difficulty: "yds", translationFocus: ["yaklaşım"], source: "Gemini · verified-model",
  });
  expect(source).toEqual({
    word: "Approach", score: 37, meanings: ["yaklaşım"],
    examples: [{ sentence, translation, difficulty: "yds", translationFocus: ["yaklaşım"], source: "Gemini · verified-model" }],
  });
});

test("changed content must not inherit tier metadata or source as though validated", () => {
  const original = {
    word: "Approach",
    examples: [{
      sentence: "This is the original example.",
      translation: "Bu ilk örnektir.",
      difficulty: "easy" as const, translationFocus: ["örnektir"],
      source: "Gemini · verified-model",
    }],
  };
  const changed = preserveExampleMetadata({
    word: "Approach",
    examples: [{
      sentence: "This is a new user example.",
      translation: "Bu yeni bir kullanıcı örneğidir.",
    }],
  }, original);
  expect(changed.examples?.[0].difficulty).toBeUndefined();
  expect(changed.examples?.[0].source).toBeUndefined();
  expect(changed.examples?.[0].translationFocus).toBeUndefined();
});
