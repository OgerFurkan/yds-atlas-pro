import { expect, test } from "bun:test";
import { replayAssessment } from "../../../backend/src/features/learning/assessment-scoring";
import { createAssessmentSnapshot, makeQuestion } from "../../../packages/shared/src/game-engine";
import { assessmentScore, wordEntrySchema } from "../../../packages/shared/src/index";

const word = wordEntrySchema.parse({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  word: "Observe",
  meanings: ["gözlemlemek"],
  score: 75,
  createdAt: "2026-11-23T00:00:00.000Z",
  updatedAt: "2026-11-23T00:00:00.000Z",
  examples: [{ sentence: "We observe patterns." }],
});

function initial() {
  return { ...createAssessmentSnapshot([word], 5, crypto.randomUUID()), assessmentActions: [] };
}

test("attempting to answer, set confidence or skip matching out of order is rejected", () => {
  const snapshot = initial();
  expect(() => replayAssessment(snapshot, [{ type: "answer", choice: "gözlemlemek" }])).toThrow();
  expect(() => replayAssessment(snapshot, [{ type: "confidence", value: 20 }])).toThrow();
  expect(() => replayAssessment(snapshot, [{ type: "advance" }, { type: "match-next" }])).toThrow();
});

test("assessment derives correctness from offered answers and only scores each stage once", () => {
  const snapshot = { ...initial(), phase: "final-meaning" as const };
  const quiz = makeQuestion(snapshot);
  if (!quiz) throw new Error("Expected the meaning question");
  expect(() =>
    replayAssessment(snapshot, [{ type: "answer", choice: "not an offered option" }]),
  ).toThrow();
  const answered = replayAssessment(snapshot, [{ type: "answer", choice: quiz.correct }]);
  expect(() => replayAssessment(answered, [{ type: "answer", choice: quiz.correct }])).toThrow();
  expect(() => replayAssessment(answered, [{ type: "advance" }])).toThrow();
  const next = replayAssessment(answered, [{ type: "confidence", value: 0 }, { type: "advance" }]);
  expect(next.phase).toBe("final-context");
  expect(next.assessment[word.id].meaning).toEqual({ correct: true, confidence: 0 });
  const wrong = makeQuestion(next)?.choices.find((choice) => choice !== word.word);
  if (!wrong) throw new Error("Expected a context distractor");
  const finished = replayAssessment(next, [{ type: "answer", choice: wrong }, { type: "advance" }]);
  expect(finished.phase).toBe("complete");
  expect(finished.assessment[word.id].context).toEqual({ correct: false, confidence: null });
  expect(assessmentScore(finished.assessment[word.id])).toBe(26);
});
