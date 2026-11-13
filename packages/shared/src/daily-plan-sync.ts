import { z } from "zod";

const dayGroupSchema = z.object({
  day: z.number().int().min(1).max(60),
  words: z.array(z.uuid()).max(40),
}).strict();

/** One account-owned snapshot of the 60-day manual word assignment plan. */
export const dailyPlanSnapshotSchema = z.object({
  groupSize: z.union([z.literal(10), z.literal(20), z.literal(30), z.literal(40)]),
  assignments: z.array(dayGroupSchema).max(60),
  excludedWordIds: z.array(z.uuid()).max(2400),
}).strict().superRefine((value, ctx) => {
  const days = new Set<number>();
  const assigned = new Set<string>();
  for (const group of value.assignments) {
    if (days.has(group.day))
      ctx.addIssue({ code: "custom", message: "A day may appear only once." });
    days.add(group.day);
    for (const id of group.words) {
      if (assigned.has(id))
        ctx.addIssue({ code: "custom", message: "A word may only belong to one day." });
      assigned.add(id);
    }
  }
  const excluded = new Set(value.excludedWordIds);
  if (excluded.size !== value.excludedWordIds.length)
    ctx.addIssue({ code: "custom", message: "Exclusions must be unique." });
  if (value.excludedWordIds.some((id) => assigned.has(id)))
    ctx.addIssue({ code: "custom", message: "Excluded words cannot also be assigned." });
});

export const dailyPlanSaveSchema = z.object({
  expectedRevision: z.number().int().min(0).max(2_147_483_646),
  snapshot: dailyPlanSnapshotSchema,
}).strict();

export type DailyPlanSnapshot = z.infer<typeof dailyPlanSnapshotSchema>;
export type DailyPlanSaveInput = z.infer<typeof dailyPlanSaveSchema>;
export type DailyPlanCloudState = { revision: number; snapshot: DailyPlanSnapshot | null };
