import { expect, test } from "bun:test";
import {
  selectMatching,
  startMatchingBoard,
} from "../../../frontend/src/features/learning-game/model/matching-engine";
import {
  buildDailyPlan,
  reviewableWords,
} from "../../../frontend/src/features/word-library/model/daily-groups";
import {
  createDayReviewMatching,
  createDayReviewRounds,
  dayReviewBoardSize,
  dayReviewMissingMeanings,
} from "../../../frontend/src/features/word-library/model/day-review";
import type { WordEntry } from "../../../packages/shared/src/index";

function word(index: number, meaning?: string, score = 100): WordEntry {
  const createdAt = "2026-01-01T00:00:00.000Z";
  return {
    id: "review-" + index,
    word: "Word" + index,
    meanings: [meaning ?? "anlam " + index],
    alternatives: [],
    usageNote: "",
    partOfSpeech: "Noun",
    cefr: "B1",
    score,
    examples: [],
    pronunciationUk: "",
    pronunciationUs: "",
    sourceUrl: "",
    createdAt,
    updatedAt: createdAt,
  };
}

test("review covers all 20 day words whether 0, 5 or 20 of them are learned", () => {
  for (const learnedCount of [0, 5, 20]) {
    const day = Array.from({ length: 20 }, (_, index) =>
      word(index, undefined, index < learnedCount ? 90 : 0),
    );
    const group = buildDailyPlan(day, 20).groups[0];
    const review = reviewableWords(group);
    expect(review).toHaveLength(20);
    expect(new Set(review.map((entry) => entry.id))).toEqual(new Set(day.map((entry) => entry.id)));
    const rounds = createDayReviewRounds(review, [], () => 0);
    expect(rounds.flat()).toHaveLength(20);
    expect(new Set(rounds.flat().map((entry) => entry.id)).size).toBe(20);
    for (const entry of review)
      expect(entry.score).toBe(day.find((item) => item.id === entry.id)?.score);
  }
});

for (const count of [1, 9, 10, 11, 20, 25, 40]) {
  test("review round boundaries preserve all " + count + " words without changing scores", () => {
    const words = Array.from({ length: count }, (_, index) => word(index));
    const original = JSON.stringify(words);
    const groups = createDayReviewRounds(words, [], () => 0);
    const expected = Math.ceil(count / 10);
    expect(groups).toHaveLength(expected);
    expect(groups.map((group) => group.length)).toEqual(
      Array.from({ length: expected }, (_, index) => Math.min(10, count - 10 * index)),
    );
    expect(new Set(groups.flat().map((entry) => entry.id)).size).toBe(count);
    const restarted = createDayReviewRounds(
      words,
      groups.flat().map((entry) => entry.id),
      () => 0,
    );
    if (count > 1)
      expect(restarted.flat().map((entry) => entry.id)).not.toEqual(
        groups.flat().map((entry) => entry.id),
      );
    expect(JSON.stringify(words)).toBe(original);
  });
}

test("missing Turkish meaning blocks a review rather than silently excluding words", () => {
  const words = [word(0), { ...word(1), meanings: ["  "] }];
  const group = buildDailyPlan(words, 10).groups[0];
  expect(reviewableWords(group)).toHaveLength(2);
  expect(dayReviewMissingMeanings(reviewableWords(group)).map((entry) => entry.id)).toEqual([
    "review-1",
  ]);
});

test("duplicate translations and identical labels appear on separate fair matching boards", () => {
  const words = [
    word(0, "aynı"),
    word(1, "aynı"),
    { ...word(2), word: "Word1", meanings: ["başka"] },
  ];
  let session = createDayReviewMatching(words);
  const seen = new Set<string>();
  while (session.queue.length) {
    const board = session.matching!;
    expect(
      new Set(board.left.map((id) => session.words.find((entry) => entry.id === id)!.meanings[0]))
        .size,
    ).toBe(board.left.length);
    expect(
      new Set(board.left.map((id) => session.words.find((entry) => entry.id === id)!.word)).size,
    ).toBe(board.left.length);
    for (const id of board.left) {
      seen.add(id);
      session = selectMatching(session, "left", id);
      session = selectMatching(session, "right", id);
    }
    if (session.queue.length) session = startMatchingBoard(session, 10);
  }
  expect(seen.size).toBe(3);
});

test("short and mobile screens show smaller matching boards while keeping 10-word rounds", () => {
  expect(dayReviewBoardSize(390, 650)).toBe(4);
  expect(dayReviewBoardSize(390, 850)).toBe(5);
  expect(dayReviewBoardSize(1280, 800)).toBe(5);
  expect(dayReviewBoardSize(1440, 1080)).toBe(10);
  const words = Array.from({ length: 11 }, (_, index) => word(index));
  const rounds = createDayReviewRounds(words, [], () => 0);
  expect(rounds.map((round) => round.length)).toEqual([10, 1]);
  const shortBoard = createDayReviewMatching(rounds[0], 4);
  expect(shortBoard.matching?.left.length).toBe(4);
  expect(shortBoard.queue).toHaveLength(10);
  expect(words.every((entry) => entry.score === 100)).toBe(true);
});
