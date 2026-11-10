import { wordInputSchema } from "./word-schema";
import { z } from "zod";

export const phases = [
  "flashcards",
  "meaning",
  "context",
  "final-matching",
  "final-meaning",
  "final-context",
  "complete",
] as const;
export type GamePhase = (typeof phases)[number];
export const phaseLabels: Record<GamePhase, string> = {
  flashcards: "Keşfet",
  meaning: "Anlamı bul",
  context: "Bağlamda öğren",
  "final-matching": "Genel değerlendirme · Eşleştirme",
  "final-meaning": "Genel değerlendirme · Anlam",
  "final-context": "Genel değerlendirme · Bağlam",
  complete: "Tamamlandı",
};
export const sessionWordSchema = wordInputSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const assessmentAnswerSchema = z.object({
  correct: z.boolean(),
  confidence: z.union([z.literal(-10), z.literal(0), z.literal(20)]).nullable(),
});
export const wordAssessmentSchema = z.object({
  matchingErrors: z.number().int().min(0),
  matchingDone: z.boolean(),
  meaning: assessmentAnswerSchema.nullable(),
  context: assessmentAnswerSchema.nullable(),
});
export const matchingSchema = z.object({
  left: z.array(z.string()).min(1).max(5),
  right: z.array(z.string()).min(1).max(5),
  matched: z.array(z.string()),
  selectedLeft: z.string().nullable(),
  selectedRight: z.string().nullable(),
  feedback: z.object({ leftId: z.string(), rightId: z.string(), correct: z.boolean() }).nullable(),
});
export const gameSessionSchema = z.object({
  version: z.union([z.literal(2), z.literal(3)]),
  id: z.string(),
  words: z.array(sessionWordSchema).min(1),
  batchSize: z.union([z.literal(5), z.literal(10)]),
  groupIndex: z.number().int().min(0),
  phase: z.enum(phases),
  queue: z.array(z.string()),
  stageCompleted: z.number().int().min(0),
  attempts: z.record(z.string(), z.number().int().min(0)),
  scoreChanges: z.record(z.string(), z.number().int()),
  assessment: z.record(z.string(), wordAssessmentSchema).default({}),
  matching: matchingSchema.nullable().default(null),
  answer: z
    .object({
      choice: z.string(),
      correct: z.boolean(),
      confidence: z.union([z.literal(-10), z.literal(0), z.literal(20)]).nullable(),
    })
    .nullable(),
  finalCorrect: z.number().int().min(0),
  finalTotal: z.number().int().min(0),
  tutorial: z.boolean(),
  saved: z.boolean(),
});
export type GameSession = z.infer<typeof gameSessionSchema>;
export type Confidence = -10 | 0 | 20;
export type WordAssessment = z.infer<typeof wordAssessmentSchema>;
