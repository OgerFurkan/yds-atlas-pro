import { z } from "zod";
import { WordEntry } from "../word-schema";

export const dailyWordGroupSchema = z.object({
  day: z.number().int().min(1).max(60),
  words: z.array(z.string()),
});

export type DailyWordGroup = z.infer<typeof dailyWordGroupSchema>;
