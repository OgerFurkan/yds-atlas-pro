/** Deterministic, explainable interval scheduler (not a claim of FSRS equivalence). */
export type ReviewRating = "again" | "hard" | "good" | "easy";

export interface ReviewSchedule {
  wordId: string;
  repetitions: number;
  lapses: number;
  intervalDays: number;
  easeFactor: number;
  dueAt: string;
  lastReviewedAt: string | null;
}

const DAY = 24 * 60 * 60 * 1000;
const TEN_MINUTES = 10 * 60 * 1000;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function newReviewSchedule(wordId: string, now = new Date()): ReviewSchedule {
  if (!wordId.trim() || !Number.isFinite(now.getTime())) throw new Error("Invalid review input");
  return {
    wordId,
    repetitions: 0,
    lapses: 0,
    intervalDays: 0,
    easeFactor: 2.5,
    dueAt: now.toISOString(),
    lastReviewedAt: null,
  };
}

/** Pure schedule transition. UI may call this only after a real recall assessment. */
export function rateReview(
  previous: ReviewSchedule,
  rating: ReviewRating,
  now = new Date(),
): ReviewSchedule {
  const when = now.getTime();
  if (!Number.isFinite(when)) throw new Error("Invalid review date");
  if (!Number.isFinite(previous.easeFactor) || previous.easeFactor < 1.3 ||
      previous.intervalDays < 0 || !Number.isFinite(previous.intervalDays))
    throw new Error("Invalid schedule");

  if (rating === "again") return {
    ...previous,
    repetitions: 0,
    lapses: previous.lapses + 1,
    intervalDays: 0,
    easeFactor: clamp(previous.easeFactor - 0.2, 1.3, 2.8),
    lastReviewedAt: now.toISOString(),
    dueAt: new Date(when + TEN_MINUTES).toISOString(),
  };

  const easeFactor = clamp(previous.easeFactor +
    (rating === "easy" ? 0.15 : rating === "hard" ? -0.15 : 0), 1.3, 2.8);
  const intervalDays = previous.intervalDays === 0
    ? rating === "easy" ? 3 : 1
    : Math.max(1, Math.ceil(previous.intervalDays *
      (rating === "hard" ? 1.2 : rating === "good" ? previous.easeFactor : previous.easeFactor * 1.3)));
  return {
    ...previous,
    repetitions: previous.repetitions + 1,
    intervalDays,
    easeFactor,
    lastReviewedAt: now.toISOString(),
    dueAt: new Date(when + intervalDays * DAY).toISOString(),
  };
}

/** Only scheduled words are considered. New library words do not flood the queue. */
export function dueReviews(schedules: readonly ReviewSchedule[], now = new Date()) {
  const timestamp = now.getTime();
  if (!Number.isFinite(timestamp)) throw new Error("Invalid review date");
  return schedules
    .filter((item) => Number.isFinite(Date.parse(item.dueAt)) && Date.parse(item.dueAt) <= timestamp)
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.wordId.localeCompare(b.wordId));
}
