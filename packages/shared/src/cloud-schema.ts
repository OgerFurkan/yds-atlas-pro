import { z } from "zod";
import { gameSessionSchema } from "./learning-game";
export const accountStateSchema = z.object({
  dailyGoal: z.number().int().min(10).max(100),
  session: z
    .object({ snapshot: gameSessionSchema, revision: z.number().int().positive() })
    .nullable(),
  progress: z.array(z.object({ day: z.iso.date(), word_id: z.uuid() })),
  completedDays: z.array(z.object({ day: z.iso.date(), goal: z.number().int() })),
});
export type AccountState = z.infer<typeof accountStateSchema>;
