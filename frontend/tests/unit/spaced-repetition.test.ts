import { expect, test } from "bun:test";
import { dueReviews, newReviewSchedule, rateReview } from "../../src/features/review/model/spaced-repetition";

const now = new Date("2026-11-13T09:00:00.000Z");

test("a new word is due immediately but does not count as a success", () => {
  const item = newReviewSchedule("word-1", now);
  expect(item.repetitions).toBe(0);
  expect(dueReviews([item], now)).toHaveLength(1);
});

test("again schedules a ten-minute retry and counts one lapse", () => {
  const updated = rateReview(newReviewSchedule("word-1", now), "again", now);
  expect(updated.dueAt).toBe("2026-11-13T09:10:00.000Z");
  expect(updated.lapses).toBe(1);
  expect(updated.repetitions).toBe(0);
});

test("good intervals expand without changing the original schedule", () => {
  const initial = newReviewSchedule("word-1", now);
  const first = rateReview(initial, "good", now);
  const second = rateReview(first, "good", new Date("2026-11-14T09:00:00.000Z"));
  expect(first.intervalDays).toBe(1);
  expect(second.intervalDays).toBe(3);
  expect(initial.intervalDays).toBe(0);
});

test("hard review grows slowly; easy review awards a longer interval", () => {
  const start = rateReview(newReviewSchedule("word-1", now), "easy", now);
  expect(start.intervalDays).toBe(3);
  expect(rateReview(start, "hard", now).intervalDays).toBe(4);
  expect(rateReview(start, "easy", now).intervalDays).toBeGreaterThan(4);
});

test("lapse reduces ease but never below minimum", () => {
  let item = newReviewSchedule("word-1", now);
  for (let i = 0; i < 20; i += 1) item = rateReview(item, "again", now);
  expect(item.easeFactor).toBe(1.3);
  expect(item.lapses).toBe(20);
});

test("due review queue uses due time order and ignores future entries", () => {
  const a = newReviewSchedule("a", new Date("2026-11-11T09:00:00.000Z"));
  const b = rateReview(newReviewSchedule("b", now), "easy", now);
  const c = newReviewSchedule("c", new Date("2026-11-12T09:00:00.000Z"));
  expect(dueReviews([b, c, a], now).map((item) => item.wordId)).toEqual(["a", "c"]);
});

test("invalid dates and schedules cannot generate corrupt due dates", () => {
  expect(() => newReviewSchedule(" ", now)).toThrow();
  expect(() => rateReview(newReviewSchedule("a", now), "good", new Date("bad"))).toThrow();
});
