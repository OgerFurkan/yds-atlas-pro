import { describe, expect, test } from "bun:test";
import type { WordEntry } from "@yds-atlas/shared";
import {
  advance,
  createSession,
  groupWords,
  isGameReady,
  makeQuestion,
  recordAnswer,
  resultScore,
  setConfidence,
  usableExamples,
} from "@/features/learning-game/model/game-engine";
import type { GameSession } from "@/features/learning-game/model/game-session";
import { continueMatching, selectMatching } from "@/features/learning-game/model/matching-engine";
import { starterVocabulary } from "@/features/word-library/data/starter-vocabulary";

function deck(count = 20): WordEntry[] {
  return starterVocabulary.slice(0, count).map((word, index) => ({
    ...word,
    id: `word-${index}`,
    createdAt: "2026-11-10T00:00:00Z",
    updatedAt: "2026-11-10T00:00:00Z",
  }));
}
function correct(session: GameSession) {
  const question = makeQuestion(session)!;
  let answered = recordAnswer(session, question.correct);
  answered = setConfidence(answered, 20);
  return advance(answered);
}

describe("learning loop", () => {
  test("all 20 starter words have 5 clozable examples and can be studied", () => {
    for (const word of deck()) {
      expect(usableExamples(word)).toHaveLength(5);
      expect(isGameReady(word)).toBe(true);
      expect(isGameReady({ ...word, score: 80 })).toBe(false);
    }
  });

  test("a forgotten flashcard stays in the queue and cannot advance the stage", () => {
    let session = createSession(deck(1), 5);
    session = advance(session, false);
    expect(session.phase).toBe("flashcards");
    expect(session.queue).toHaveLength(1);
    expect(session.stageCompleted).toBe(0);
    session = advance(session, true);
    expect(session.phase).toBe("meaning");
    expect(session.scoreChanges).toEqual({});
  });

  test("wrong meaning and context answers repeat, with a different context example", () => {
    let session = advance(createSession(deck(1), 5));
    let question = makeQuestion(session)!;
    session = advance(
      recordAnswer(session, question.choices.find((choice) => choice !== question.correct)!),
    );
    expect(session.phase).toBe("meaning");
    session = correct(session);
    expect(session.phase).toBe("context");
    question = makeQuestion(session)!;
    const firstSentence = question.sentence;
    session = advance(
      recordAnswer(session, question.choices.find((choice) => choice !== question.correct)!),
    );
    expect(session.phase).toBe("context");
    expect(makeQuestion(session)!.sentence).not.toBe(firstSentence);
    expect(session.scoreChanges).toEqual({});
  });

  test("the entire 20-word route completes for both group sizes", () => {
    for (const batch of [5, 10] as const) {
      let session = createSession(deck(), batch);
      const groups = new Set<number>();
      let iterations = 0;
      while (session.phase !== "complete" && iterations++ < 200) {
        groups.add(session.groupIndex);
        expect(groupWords(session).length).toBe(batch);
        if (session.phase === "final-matching") {
          for (const id of session.matching!.left) {
            session = selectMatching(selectMatching(session, "left", id), "right", id);
          }
          session = continueMatching(session);
        } else session = session.phase === "flashcards" ? advance(session) : correct(session);
      }
      expect(session.phase).toBe("complete");
      expect(groups.size).toBe(20 / batch);
      expect(session.finalCorrect).toBe(60);
      expect(session.finalTotal).toBe(60);
      expect(session.scoreChanges).toEqual({});
      for (const word of session.words) expect(resultScore(session, word)).toBe(100);
    }
  });

  test("final answer is locked and requires confidence before advancing", () => {
    let session: GameSession = { ...createSession(deck(1), 5), phase: "final-meaning" };
    const question = makeQuestion(session)!;
    session = recordAnswer(session, question.correct);
    const locked = recordAnswer(
      session,
      question.choices.find((choice) => choice !== question.correct)!,
    );
    expect(locked).toEqual(session);
    expect(advance(session)).toEqual(session);
    session = advance(setConfidence(session, -10));
    expect(resultScore(session, question.word)).toBe(18);
    expect(session.phase).toBe("final-context");
    session = advance(setConfidence(recordAnswer(session, makeQuestion(session)!.correct), 0));
    expect(resultScore(session, question.word)).toBe(61);
  });

  test("legacy sessions retain their original scoring and final stages", () => {
    let session: GameSession = { ...createSession(deck(1), 5), version: 2, phase: "final-meaning" };
    for (let i = 0; i < 2; i++) {
      const question = makeQuestion(session)!;
      session = advance(
        recordAnswer(session, question.choices.find((choice) => choice !== question.correct)!),
      );
    }
    expect(session.phase).toBe("complete");
    expect(session.finalTotal).toBe(2);
    expect(session.finalCorrect).toBe(0);
    expect(session.scoreChanges[session.words[0].id]).toBe(-80);
    expect(resultScore(session, session.words[0])).toBe(0);
  });

  test("choices are stable after reload, unique, and hide the answer in context", () => {
    for (const word of deck()) {
      const session: GameSession = { ...createSession([word], 5), phase: "context" };
      const question = makeQuestion(session)!;
      expect(question.choices).toHaveLength(4);
      expect(new Set(question.choices).size).toBe(4);
      expect(question.sentence).toContain("________");
      expect(question.sentence!.toLowerCase()).not.toContain(word.word.toLowerCase());
      expect(makeQuestion(JSON.parse(JSON.stringify(session)))!.choices).toEqual(question.choices);
    }
  });

  test("cloze matches whole words, escapes regex syntax and supports explicit inflections", () => {
    const base = deck(1)[0];
    const word = {
      ...base,
      word: "Act",
      examples: [{ sentence: "The factory is open.", translation: "" }],
    };
    expect(usableExamples(word)).toHaveLength(0);
    expect(
      usableExamples({
        ...word,
        word: "C++",
        examples: [{ sentence: "We use C++ daily.", translation: "" }],
      }),
    ).toHaveLength(1);
    expect(
      usableExamples({
        ...word,
        alternatives: ["acted"],
        examples: [{ sentence: "He acted quickly.", translation: "" }],
      }),
    ).toHaveLength(1);
  });
});
