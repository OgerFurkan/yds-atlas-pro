import { z } from "zod";

/** Validated account-bound review schedule transport, not the guest ledger. */
export const cloudReviewScheduleSchema = z.object({
  wordId: z.uuid(),
  repetitions: z.number().int().min(0),
  lapses: z.number().int().min(0),
  intervalDays: z.number().int().min(0).max(36500),
  easeFactor: z.number().min(1.3).max(2.8),
  dueAt: z.iso.datetime(),
  lastReviewedAt: z.iso.datetime().nullable(),
}).strict();

export const cloudReviewSchedulesResponseSchema = z.object({
  schedules: z.array(cloudReviewScheduleSchema).max(5000),
}).strict();

export type CloudReviewSchedule = z.infer<typeof cloudReviewScheduleSchema>;
export type CloudReviewSchedulesResponse = z.infer<typeof cloudReviewSchedulesResponseSchema>;
