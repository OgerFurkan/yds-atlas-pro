import { z } from "zod";
import { aiWordSchema } from "./ai-schema";
import { wordExampleSchema, wordPartOfSpeechSchema } from "./word-schema";

export const tieredExampleSchema = wordExampleSchema.extend({
  difficulty: z.enum(["easy", "medium", "yds"]),
  translationFocus: z.array(z.string().trim().min(1)).min(1).max(4),
});
export const tieredAiWordSchema = aiWordSchema.extend({
  examples: z.array(tieredExampleSchema).length(5),
});
export const lexiconResolveRequestSchema = z.object({
  word: z.string().trim().min(1).max(120),
  partOfSpeech: wordPartOfSpeechSchema.optional(),
  meaning: z.string().trim().min(1).max(200).optional(),
}).strict();
export const lexiconResponseSchema = z.object({
  source: z.enum(["pool","generated"]),
  entry: z.object({
    id:z.uuid(),wordKey:z.string(),partOfSpeech:wordPartOfSpeechSchema,
    senseKey:z.string(),revision:z.number().int().min(1),
    status:z.enum(["machine_validated","human_reviewed"]),
    content:tieredAiWordSchema,
    provenance:z.record(z.string(),z.unknown()),
  }),
});
export const lexiconCandidatesResponseSchema = z.object({
  candidates:z.array(z.object({
    partOfSpeech:wordPartOfSpeechSchema,
    meaning:z.string().min(1),
    revision:z.number().int().min(1),
  })).max(29),
});
export type TieredAiWord = z.infer<typeof tieredAiWordSchema>;
export type LexiconResolveRequest = z.infer<typeof lexiconResolveRequestSchema>;
