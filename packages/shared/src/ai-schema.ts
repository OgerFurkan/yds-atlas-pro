import { z } from "zod";
import { cefrLevelSchema } from "./word-schema";
export const aiWordRequestSchema = z
  .object({
    word: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-zA-Z]+(?:[ '-][a-zA-Z]+)*$/, "Tek bir İngilizce kelime veya kısa ifade yaz."),
  })
  .strict();
export const aiWordSchema = z
  .object({
    word: z.string().min(1).max(120),
    alternatives: z.array(z.string().min(1).max(120)).max(8),
    meanings: z.array(z.string().min(1).max(200)).min(1).max(4),
    usageNote: z.string().min(1).max(1500),
    partOfSpeech: z.enum([
      "Noun",
      "Verb",
      "Adjective",
      "Adverb",
      "Preposition",
      "Conjunction",
      "Pronoun",
      "Phrase",
    ]),
    cefr: cefrLevelSchema,
    examples: z
      .array(
        z.object({
          sentence: z.string().min(1).max(1000),
          translation: z.string().min(1).max(1000),
          translationFocus: z.array(z.string().min(1).max(200)).min(1).max(4),
        }),
      )
      .length(5),
  })
  .strict();
export const aiWordResponseSchema = z.object({
  suggestion: aiWordSchema,
  provider: z.literal("Gemini"),
  model: z.string(),
});
export type AiWordResponse = z.infer<typeof aiWordResponseSchema>;
