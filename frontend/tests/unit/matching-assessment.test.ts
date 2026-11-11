import { describe, expect, test } from "bun:test";
import { assessmentScore, emptyAssessment } from "@/features/learning-game/model/assessment";
import { createSession, resultScore } from "@/features/learning-game/model/game-engine";
import { type GameSession, gameSessionSchema } from "@/features/learning-game/model/game-session";
import {
  continueMatching,
  retryMatching,
  selectMatching,
  startMatchingBoard,
} from "@/features/learning-game/model/matching-engine";
import { starterVocabulary } from "@/features/word-library/data/starter-vocabulary";

function matchingSession(count = 7): GameSession {
  const words = starterVocabulary.slice(0, count).map((word, index) => ({
    ...word,
    id: `pair-${index}`,
    createdAt: "2026-11-10T00:00:00Z",
    updatedAt: "2026-11-10T00:00:00Z",
  }));
  const session = createSession(words, 5);
  return startMatchingBoard({
    ...session,
    phase: "final-matching",
    queue: session.words.map((word) => word.id),
  });
}

describe("matching and knowledge assessment", () => {
  test("boards contain at most five unique pairs and cannot skip unfinished words", () => {
    let session = matchingSession();
    expect(session.matching!.left).toHaveLength(5);
    expect(new Set(session.matching!.left)).toEqual(new Set(session.matching!.right));
    expect(continueMatching(session)).toBe(session);
    for (const id of session.matching!.left) {
      session = selectMatching(selectMatching(session, "right", id), "left", id);
    }
    expect(session.queue).toHaveLength(2);
    expect(session.stageCompleted).toBe(5);
    const completed = session;
    expect(selectMatching(session, "left", session.matching!.left[0])).toBe(completed);
    session = continueMatching(session);
    expect(session.matching!.left).toHaveLength(2);
    for (const id of session.matching!.left)
      session = selectMatching(selectMatching(session, "left", id), "right", id);
    session = continueMatching(session);
    expect(session.phase).toBe("final-meaning");
    expect(session.queue).toHaveLength(7);
    expect(session.finalCorrect).toBe(7);
    expect(session.finalTotal).toBe(7);
  });

  test("a wrong pair records one error for both words, locks until retry and cannot double count", () => {
    let session = matchingSession(3);
    const [leftId, rightId] = session.matching!.left;
    session = selectMatching(selectMatching(session, "left", leftId), "right", rightId);
    expect(session.matching!.feedback?.correct).toBe(false);
    expect(session.assessment[leftId].matchingErrors).toBe(1);
    expect(session.assessment[rightId].matchingErrors).toBe(1);
    expect(session.finalTotal).toBe(0);
    expect(selectMatching(session, "right", leftId)).toBe(session);
    session = retryMatching(session);
    expect(session.matching!.selectedLeft).toBeNull();
    session = selectMatching(selectMatching(session, "left", leftId), "right", leftId);
    expect(session.assessment[leftId].matchingDone).toBe(true);
    expect(session.assessment[leftId].matchingErrors).toBe(1);
    expect(session.finalTotal).toBe(1);
    expect(session.finalCorrect).toBe(0);
    const before = session;
    expect(selectMatching(session, "right", leftId)).toBe(before);
    expect(selectMatching(session, "left", "unknown")).toBe(before);
  });

  test("repeated selection stays selected and survives serialization without reshuffling", () => {
    const original = matchingSession(5);
    const id = original.matching!.right[0];
    const selected = selectMatching(original, "right", id);
    const restored = gameSessionSchema.parse(JSON.parse(JSON.stringify(selected)));
    expect(restored.matching).toEqual(selected.matching);
    expect(selectMatching(restored, "right", id)).toBe(restored);
    const matched = selectMatching(restored, "left", id);
    expect(matched.matching!.matched).toContain(id);
  });

  test("identical translations appear on separate boards", () => {
    const original = matchingSession(3);
    const words = original.words.map((word) => ({ ...word, meanings: ["Aynı anlam"] }));
    let session = startMatchingBoard({ ...original, words });
    expect(session.matching!.left).toHaveLength(1);
    const id = session.matching!.left[0];
    session = selectMatching(selectMatching(session, "left", id), "right", id);
    expect(continueMatching(session).matching!.left).toHaveLength(1);
  });

  test("recognition, meaning and context weigh 20, 30 and 50; confidence tempers correct answers", () => {
    const measured = { ...emptyAssessment(), matchingDone: true };
    expect(assessmentScore(measured)).toBe(20);
    for (const [confidence, expected] of [
      [20, 100],
      [0, 88],
      [-10, 68],
    ] as const) {
      expect(
        assessmentScore({
          ...measured,
          meaning: { correct: true, confidence },
          context: { correct: true, confidence },
        }),
      ).toBe(expected);
    }
    expect(
      assessmentScore({
        ...measured,
        meaning: { correct: false, confidence: null },
        context: { correct: true, confidence: 20 },
      }),
    ).toBe(70);
    expect(
      assessmentScore({
        ...measured,
        meaning: { correct: true, confidence: 20 },
        context: { correct: false, confidence: null },
      }),
    ).toBe(50);
    expect(assessmentScore({ ...measured, matchingErrors: 20 })).toBe(0);
  });

  test("new measured scores replace prior scores; repeated evaluation cannot inflate mastery", () => {
    const session = matchingSession(1);
    const word = { ...session.words[0], score: 75 };
    session.assessment[word.id] = {
      ...emptyAssessment(),
      matchingDone: true,
      meaning: { correct: true, confidence: -10 },
      context: { correct: true, confidence: -10 },
    };
    expect(resultScore(session, word)).toBe(68);
    expect(resultScore(session, { ...word, score: 68 })).toBe(68);
    expect(assessmentScore(undefined)).toBe(0);
  });

  test("old version two snapshots are accepted with defaults and retain absolute result rules", () => {
    const session = matchingSession(1);
    const { assessment: _assessment, matching: _matching, ...old } = session;
    const restored = gameSessionSchema.parse({
      ...old,
      version: 2,
      phase: "final-meaning",
      scoreChanges: { [session.words[0].id]: 50 },
    });
    expect(restored.assessment).toEqual({});
    expect(restored.matching).toBeNull();
    expect(resultScore(restored, { ...session.words[0], score: 20 })).toBe(70);
  });
});
