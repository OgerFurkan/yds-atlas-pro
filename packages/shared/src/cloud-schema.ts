import { z } from "zod";
import { gameSessionSchema } from "./learning-game";

export const DEFAULT_DAILY_GOAL = 20;
export const dailyGoalSchema = z.number().int().min(10).max(100).multipleOf(10);

export const accountStateSchema = z.object({
  onlineProtocol: z.literal(1).optional(),
  planProtocol: z.literal(1).optional(),
  dailyGoal: dailyGoalSchema,
  session: z
    .object({ snapshot: gameSessionSchema, revision: z.number().int().positive() })
    .nullable(),
  progress: z.array(z.object({ day: z.iso.date(), word_id: z.uuid() })),
  completedDays: z.array(z.object({ day: z.iso.date(), goal: z.number().int() })),
});
export type AccountState = z.infer<typeof accountStateSchema>;

export const privatePlanSchema = z
  .object({
    size: z.number().int().min(10).max(40),
    groups: z
      .array(
        z
          .object({ day: z.number().int().min(1).max(60), words: z.array(z.uuid()).max(40) })
          .strict(),
      )
      .max(60),
    exclusions: z.array(z.uuid()).max(25000),
  })
  .strict();
export type PrivatePlan = z.infer<typeof privatePlanSchema>;
export const accountPlanSchema = z
  .object({
    owner: z.uuid(),
    revision: z.number().int().nonnegative(),
    plan: privatePlanSchema.nullable(),
  })
  .refine((s) => (s.revision === 0) === (s.plan === null));
export type AccountPlan = z.infer<typeof accountPlanSchema>;

export const wordCursorSchema = z
  .object({
    owner: z.uuid(),
    revision: z.string().regex(/^\d{1,19}$/),
    time: z.iso.datetime({ offset: true }),
    id: z.uuid(),
  })
  .strict();
export type WordCursor = z.infer<typeof wordCursorSchema>;
