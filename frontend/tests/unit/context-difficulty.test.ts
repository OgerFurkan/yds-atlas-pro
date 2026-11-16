import { describe, expect, test } from "bun:test";
import { wordExampleSchema } from "@yds-atlas/shared";
import { contextExamplesForPhase } from "@/features/learning-game/model/context-examples";
import {
  createSession,
  makeQuestion,
  recordAnswer,
  advance,
  usableExamples,
} from "@/features/learning-game/model/game-engine";
import type { GameSession } from "@/features/learning-game/model/game-session";
import { starterVocabulary } from "@/features/word-library/data/starter-vocabulary";

const fixed = (word: (typeof starterVocabulary)[number]): GameSession => ({
  ...createSession(
    [
      {
        ...word,
        id: `example-${word.word}`,
        createdAt: "2026-11-16T00:00:00Z",
        updatedAt: "2026-11-16T00:00:00Z",
      },
    ],
    5,
  ),
  phase: "context",
});

describe("instruction context vs YDS-targeted final context", () => {
  test("all starter words have two short, translated practice examples and three exam-intended examples", () => {
    expect(starterVocabulary).toHaveLength(20);
    for (const word of starterVocabulary) {
      expect(usableExamples(word)).toHaveLength(5);
      const practice = word.examples.filter((x) => x.purpose === "practice");
      const exam = word.examples.filter((x) => x.purpose === "exam");
      expect(practice).toHaveLength(2);
      expect(exam).toHaveLength(3);
      for (const x of practice) {
        expect(x.sentence.split(/\s+/).length).toBeLessThanOrEqual(10);
        expect(x.translation).not.toBe("");
        expect(x.translationFocus?.every((focus) => x.translation.includes(focus))).toBe(true);
      }
    }
  });

  test("group questions use only short practice, while final uses only other examples", () => {
    for (const word of starterVocabulary) {
      const initial = fixed(word);
      const groupQ = makeQuestion(initial)!;
      expect(groupQ.example?.purpose).toBe("practice");
      const final: GameSession = { ...initial, phase: "final-context" };
      const finalQ = makeQuestion(final)!;
      expect(finalQ.example?.purpose).toBe("exam");
      expect(finalQ.sentence).toContain("________");
      expect(finalQ.sentence).not.toBe(groupQ.sentence);
      expect(makeQuestion(JSON.parse(JSON.stringify(final)))?.example).toEqual(finalQ.example);
    }
  });

  test("wrong group answer rotates short practice examples without mutating mastery", () => {
    const first = fixed(starterVocabulary[0]);
    const q = makeQuestion(first)!;
    const wrong = q.choices.find((x) => x !== q.correct)!;
    const retried = advance(recordAnswer(first, wrong));
    expect(retried.phase).toBe("context");
    expect(retried.scoreChanges).toEqual({});
    expect(makeQuestion(retried)?.sentence).not.toBe(q.sentence);
    expect(makeQuestion(retried)?.example?.purpose).toBe("practice");
    expect(makeQuestion(JSON.parse(JSON.stringify(retried)))?.sentence).toBe(
      makeQuestion(retried)?.sentence,
    );
  });

  test("two tagged practice sentences both appear across attempts", () => {
    for (const word of starterVocabulary) {
      let session = fixed(word);
      const used = new Set<string>();
      for (let i = 0; i < 2; i++) {
        const question = makeQuestion(session)!;
        used.add(question.example!.sentence);
        expect(question.example?.purpose).toBe("practice");
        const wrong = question.choices.find((choice) => choice !== question.correct)!;
        session = advance(recordAnswer(session, wrong));
      }
      expect(used.size).toBe(2);
    }
  });

  test("old user words without purpose preserve the legacy five-example pool", () => {
    const legacy = starterVocabulary[0].examples.map(
      ({ purpose: _purpose, ...example }) => example,
    );
    const parsed = legacy.map((x) => wordExampleSchema.parse(x));
    expect(parsed.every((x) => x.purpose === undefined)).toBe(true);
    expect(contextExamplesForPhase(parsed, false)).toEqual(parsed);
    expect(contextExamplesForPhase(parsed, true)).toEqual(parsed);
  });

  test("if a stage has no matching content, it uses legacy fallback, not a fake exam label", () => {
    const practiceOnly = [{ sentence: "We can improve.", purpose: "practice" as const }];
    expect(contextExamplesForPhase(practiceOnly, true)).toEqual(practiceOnly);
  });
});
