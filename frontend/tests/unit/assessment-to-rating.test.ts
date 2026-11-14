import { expect, test } from "bun:test";
import { rateCompletedGame } from "@/features/review/model/assessment-to-rating";
import { completeSession } from "../fixtures/review-session";


test("complete regular assessment maps to good, not an arbitrary word score", () => {
  const session = completeSession();
  expect(rateCompletedGame(session)).toEqual([{ wordId: "word-1", rating: "good" }]);
  expect(session.words[0].score).toBe(20);
});

test("incorrect meaning or context maps to again", () => {
  const session = completeSession();
  session.assessment["word-1"].context = { correct: false, confidence: null };
  expect(rateCompletedGame(session)[0].rating).toBe("again");
});

test("matching errors or low-confidence correct answers map to hard", () => {
  const session = completeSession();
  session.assessment["word-1"].matchingErrors = 1;
  expect(rateCompletedGame(session)[0].rating).toBe("hard");
  session.assessment["word-1"].matchingErrors = 0;
  session.assessment["word-1"].meaning = { correct: true, confidence: -10 };
  expect(rateCompletedGame(session)[0].rating).toBe("hard");
});

test("two confident correct answers with zero matching errors map to easy", () => {
  const session = completeSession();
  session.assessment["word-1"].meaning = { correct: true, confidence: 20 };
  session.assessment["word-1"].context = { correct: true, confidence: 20 };
  expect(rateCompletedGame(session)[0].rating).toBe("easy");
});

test("unsupported, tutorial or unfinished sessions fail closed", () => {
  const session = completeSession();
  session.tutorial = true;
  expect(() => rateCompletedGame(session)).toThrow();
  session.tutorial = false;
  session.phase = "final-meaning";
  expect(() => rateCompletedGame(session)).toThrow();
  session.phase = "complete";
  session.version = 2;
  expect(() => rateCompletedGame(session)).toThrow();
});

test("a missing final assessment fails without partial results", () => {
  const session = completeSession();
  session.assessment["word-1"].context = null;
  expect(() => rateCompletedGame(session)).toThrow();
});

test("duplicate word IDs fail closed", () => {
  const session = completeSession();
  session.words.push({ ...session.words[0] });
  expect(() => rateCompletedGame(session)).toThrow();
});
