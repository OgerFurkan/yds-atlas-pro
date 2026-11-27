import { z } from "zod";

export const cefrLevelSchema = z.enum(["A1", "A2", "B1", "B2", "C1", "C2", "Belirtilmedi"]);
export const wordGroupSchema = z.enum(["hard", "review", "learned"]);

export const wordAttributionSchema = z.object({
  license: z.literal("CC BY-SA 4.0"),
  source: z.url({ protocol: /^https$/ }),
  author: z.string().trim().min(1).max(300),
  modified: z.literal(true).optional(),
});
export type WordAttribution = z.infer<typeof wordAttributionSchema>;

export const wordExampleSchema = z.object({
  sentence: z.string().trim().min(1),
  translation: z.string().trim().default(""),
  translationFocus: z.array(z.string().trim().min(1)).optional(),
  source: z.string().trim().optional(),
  difficulty: z.enum(["easy", "medium", "yds"]).optional(),
});

export const lexiconRevisionSchema = z
  .object({
    entryId: z.uuid(),
    revision: z.number().int().min(1),
    contractVersion: z.literal(1),
  })
  .strict();

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
  lexicon: lexiconRevisionSchema.optional(),
  attribution: wordAttributionSchema.optional(),
});

export const wordCheckSchema = z.object({
  word: z.string().trim().min(1).max(120),
});

export const wordEditSchema = z
  .strictObject({
    word: wordInputSchema.shape.word,
    alternatives: wordInputSchema.shape.alternatives.removeDefault(),
    meanings: wordInputSchema.shape.meanings.removeDefault(),
    usageNote: wordInputSchema.shape.usageNote.removeDefault(),
    partOfSpeech: wordInputSchema.shape.partOfSpeech.removeDefault(),
    cefr: wordInputSchema.shape.cefr.removeDefault(),
    examples: wordInputSchema.shape.examples.removeDefault(),
    pronunciationUk: wordInputSchema.shape.pronunciationUk.removeDefault(),
    pronunciationUs: wordInputSchema.shape.pronunciationUs.removeDefault(),
    sourceUrl: wordInputSchema.shape.sourceUrl.removeDefault(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0);

export type WordEdit = z.input<typeof wordEditSchema>;

export function mergeWordEdit<T extends Record<string, unknown>>(current: T, patch: WordEdit) {
  const next = { ...current, ...patch };
  if (
    patch.word !== undefined ||
    patch.partOfSpeech !== undefined ||
    patch.meanings !== undefined ||
    patch.examples !== undefined
  )
    delete next.lexicon;
  if (
    current.attribution &&
    Object.entries(patch).some(
      ([key, value]) =>
        ["word", "meanings", "examples", "usageNote", "alternatives", "partOfSpeech"].includes(
          key,
        ) && JSON.stringify(value) !== JSON.stringify(current[key]),
    )
  ) {
    const credit = wordAttributionSchema.safeParse(current.attribution);
    if (credit.success)
      return { ...next, attribution: { ...credit.data, modified: true as const } };
  }
  return next;
}

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
