import { z } from "zod";
import type { phases } from "./learning-game";
import type { WordEntry, WordExample } from "./word-schema";

export const onlineStartSchema = z.strictObject({
  command: z.uuid(),
  words: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
  batchSize: z.union([z.literal(5), z.literal(10)]),
  day: z.number().int().min(1).max(60).optional(),
});
export const onlineActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("choose"), token: z.string().regex(/^[a-f0-9]{32}$/) }),
  z.strictObject({ kind: z.literal("next") }),
  z.strictObject({
    kind: z.literal("confidence"),
    value: z.union([z.literal(-10), z.literal(0), z.literal(20)]),
  }),
  z.strictObject({ kind: z.literal("cancel") }),
]);
export const onlineCommandSchema = z.strictObject({
  command: z.uuid(),
  revision: z.number().int().positive(),
  action: onlineActionSchema,
});
export type OnlineCommand = z.infer<typeof onlineCommandSchema>;
export type OnlineStart = z.infer<typeof onlineStartSchema>;
export type OnlineAction = z.infer<typeof onlineActionSchema>;
type OnlineLesson = Pick<
  WordEntry,
  | "word"
  | "meanings"
  | "partOfSpeech"
  | "cefr"
  | "usageNote"
  | "pronunciationUk"
  | "pronunciationUs"
  | "attribution"
> & { sentence?: string; translation?: string; examples: WordExample[] };

export type OnlineView = {
  id: string;
  revision: number;
  status: "active" | "complete" | "cancelled" | "expired";
  phase: (typeof phases)[number];
  group: number;
  total: number;
  done: number;
  prompt?: string;
  lesson?: OnlineLesson;
  choices?: {
    token: string;
    text: string;
    side?: "left" | "right";
    selected?: boolean;
    matched?: boolean;
  }[];
  feedback?: boolean;
  confidence?: boolean;
  next?: boolean;
  results?: { word: string; meaning: string; score: number | null }[];
};
