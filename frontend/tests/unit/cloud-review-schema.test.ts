import { expect, test } from "bun:test";
import { cloudReviewSchedulesResponseSchema } from "@yds-atlas/shared";

const schedule = {
  wordId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  repetitions: 1,
  lapses: 0,
  intervalDays: 1,
  easeFactor: 2.5,
  dueAt: "2026-11-14T09:00:00.000Z",
  lastReviewedAt: null,
};

test("review response accepts a normalized and bounded schedule", () => {
  expect(cloudReviewSchedulesResponseSchema.parse({ schedules: [schedule] }).schedules).toHaveLength(1);
  expect(cloudReviewSchedulesResponseSchema.parse({ schedules: [] }).schedules).toEqual([]);
});

test("review response rejects unexpected owner or server-only fields", () => {
  expect(cloudReviewSchedulesResponseSchema.safeParse({ schedules: [{ ...schedule, user_id: "secret" }] }).success).toBe(false);
  expect(cloudReviewSchedulesResponseSchema.safeParse({ schedules: [], owner: "different-user" }).success).toBe(false);
});

test("review response rejects invalid IDs, dates, eases and oversized payloads", () => {
  expect(cloudReviewSchedulesResponseSchema.safeParse({ schedules: [{ ...schedule, wordId: "a" }] }).success).toBe(false);
  expect(cloudReviewSchedulesResponseSchema.safeParse({ schedules: [{ ...schedule, dueAt: "tomorrow" }] }).success).toBe(false);
  expect(cloudReviewSchedulesResponseSchema.safeParse({ schedules: [{ ...schedule, easeFactor: 7 }] }).success).toBe(false);
  expect(cloudReviewSchedulesResponseSchema.safeParse({ schedules: Array.from({ length: 5001 }, () => schedule) }).success).toBe(false);
});
