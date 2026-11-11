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
export const dictionarySourceSchema = z
  .object({
    word: z.string().min(1).max(120),
    provider: z.literal("DictionaryAPI.dev"),
    sourceUrl: z.url(),
    licenseName: z.string().min(1).max(80),
    licenseUrl: z.url(),
    definitions: z.array(z.string().min(1).max(500)).max(3),
    examples: z.array(z.object({ sentence: z.string().min(1).max(1000) }).strict()).max(2),
  })
  .strict();
export const aiWordResponseSchema = z.object({
  suggestion: aiWordSchema,
  provider: z.literal("Gemini"),
  model: z.string(),
  dictionarySource: dictionarySourceSchema.optional(),
});
export const aiWordListRequestSchema = z
  .object({
    count: z.number().int().min(1).max(5),
    exclude: z.array(aiWordRequestSchema.shape.word).max(200).default([]),
  })
  .strict();
export const aiWordListResponseSchema = z.object({
  suggestions: z.array(aiWordSchema).min(1).max(5),
  provider: z.literal("Gemini"),
  model: z.string(),
  dictionarySources: z.array(dictionarySourceSchema).max(5).optional(),
});
export const aiNamedWordsRequestSchema = z
  .object({
    words: z.array(aiWordRequestSchema.shape.word).min(1).max(5),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.words.map((word) => word.toLocaleLowerCase("en"))).size === value.words.length,
    "Tekrarlanan kelime gönderilemez.",
  );
export const aiChatRequestSchema = z
  .object({
    messages: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().trim().min(1).max(1800),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict()
  .refine((value) => value.messages.at(-1)?.role === "user", "Son mesaj kullanıcıdan gelmelidir.")
  .refine(
    (value) => value.messages.reduce((total, message) => total + message.content.length, 0) <= 9000,
    "Konuşma çok uzun.",
  );
export const aiChatResponseSchema = z
  .object({
    reply: z.string().min(1).max(5000),
    provider: z.literal("Gemini"),
    model: z.string(),
  })
  .strict();
export type AiWordResponse = z.infer<typeof aiWordResponseSchema>;
export type AiWordListResponse = z.infer<typeof aiWordListResponseSchema>;
export type DictionarySource = z.infer<typeof dictionarySourceSchema>;
export type AiChatRequest = z.infer<typeof aiChatRequestSchema>;
export type AiChatResponse = z.infer<typeof aiChatResponseSchema>;
