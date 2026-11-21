import { expect, test } from "bun:test";
import type { WordEntry } from "@yds-atlas/shared";
import { createDayReviewRounds, createDayReviewMatching, dayReviewMissingMeanings } from "@/features/word-library/model/day-review";
import { selectMatching, startMatchingBoard } from "@/features/learning-game/model/matching-engine";

function word(index: number, meaning?: string): WordEntry {
  const createdAt = "2026-01-01T00:00:00.000Z";
  return {
    id: "review-" + index, word: "Word" + index,
    meanings: [meaning ?? "anlam " + index], alternatives: [], usageNote: "",
    partOfSpeech: "Noun", cefr: "B1", score: 100,
    examples: [], pronunciationUk: "", pronunciationUs: "", sourceUrl: "",
    createdAt, updatedAt: createdAt,
  };
}

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
    const restarted = createDayReviewRounds(words, groups.flat().map((entry) => entry.id), () => 0);
    if (count > 1) expect(restarted.flat().map((entry) => entry.id)).not.toEqual(groups.flat().map((entry) => entry.id));
    expect(JSON.stringify(words)).toBe(original);
  });
}

test("missing Turkish meaning blocks a review rather than silently excluding words", () => {
  const words = [word(0), { ...word(1), meanings: ["  "] }];
  expect(dayReviewMissingMeanings(words).map((entry) => entry.id)).toEqual(["review-1"]);
});

test("duplicate translations and identical labels appear on separate fair matching boards", () => {
  const words = [word(0, "aynı"), word(1, "aynı"), { ...word(2), word: "Word1", meanings: ["başka"] }];
  let session = createDayReviewMatching(words);
  const seen = new Set<string>();
  while (session.queue.length) {
    const board = session.matching!;
    expect(new Set(board.left.map((id) => session.words.find((entry) => entry.id === id)!.meanings[0])).size).toBe(board.left.length);
    expect(new Set(board.left.map((id) => session.words.find((entry) => entry.id === id)!.word)).size).toBe(board.left.length);
    for (const id of board.left) {
      seen.add(id);
      session = selectMatching(session, "left", id);
      session = selectMatching(session, "right", id);
    }
    if (session.queue.length) session = startMatchingBoard(session, 10);
  }
  expect(seen.size).toBe(3);
});
