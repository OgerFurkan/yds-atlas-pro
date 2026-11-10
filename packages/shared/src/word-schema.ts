import { z } from "zod";

export const cefrLevelSchema = z.enum(["A1", "A2", "B1", "B2", "C1", "C2", "Belirtilmedi"]);
export const wordGroupSchema = z.enum(["hard", "review", "learned"]);

export const wordExampleSchema = z.object({
  sentence: z.string().trim().min(1),
  translation: z.string().trim().default(""),
  translationFocus: z.array(z.string().trim().min(1)).optional(),
  source: z.string().trim().optional(),
});

export const wordInputSchema = z.object({
  word: z.string().trim().min(1, "İngilizce kelime alanı zorunludur.").max(120),
  alternatives: z.array(z.string().trim().min(1)).default([]),
  meanings: z.array(z.string().trim().min(1)).default([]),
  usageNote: z.string().trim().default(""),
  partOfSpeech: z.string().trim().default(""),
  cefr: cefrLevelSchema.default("Belirtilmedi"),
  score: z.number().int().min(0).max(100).default(0),
  examples: z.array(wordExampleSchema).default([]),
  pronunciationUk: z.string().trim().default(""),
  pronunciationUs: z.string().trim().default(""),
  sourceUrl: z.string().trim().default(""),
});

export const wordCheckSchema = z.object({
  word: z.string().trim().min(1).max(120),
});

export type CefrLevel = z.infer<typeof cefrLevelSchema>;
export type WordGroup = z.infer<typeof wordGroupSchema>;
export type WordExample = z.infer<typeof wordExampleSchema>;
export const wordEntrySchema = wordInputSchema.extend({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WordEntry = z.infer<typeof wordEntrySchema>;
export type WordInput = z.input<typeof wordInputSchema>;
export type WordCheckInput = z.infer<typeof wordCheckSchema>;

export interface HealthResponse {
  status: "ok";
}

export function getWordGroup(score: number): WordGroup {
  if (score < 40) return "hard";
  if (score < 80) return "review";
  return "learned";
}
