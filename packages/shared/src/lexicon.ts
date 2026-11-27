import { z } from "zod";
import { aiWordSchema } from "./ai-schema";

export const lexiconTerms = z
  .array(
    z
      .string()
      .max(120)
      .regex(/^[a-z]+(?:[' -][a-z]+)*$/),
  )
  .min(1)
  .max(96);
export const lexiconPreview = z.object({
  id: z.uuid(),
  word: z.string().max(120),
  partOfSpeech: z.string().max(32),
  senseKey: z.string().regex(/^[0-9a-f]{64}$/),
  revision: z.number().int().positive(),
  meanings: z.array(z.string().min(1).max(200)).min(1).max(4),
  ipaUk: z.string().max(120).nullable(),
  ipaUs: z.string().max(120).nullable(),
  attribution: z
    .object({
      source: z.url({ protocol: /^https$/ }),
      license: z.literal("CC BY-SA 4.0"),
      author: z.string().min(1),
    })
    .nullable(),
  audioUk: z.url({ protocol: /^https$/ }).nullable(),
  audioUs: z.url({ protocol: /^https$/ }).nullable(),
});
export type LexiconPreview = z.infer<typeof lexiconPreview>;
export { lemmaCandidates } from "./word-key";

const audio = z
  .url({ protocol: /^https$/ })
  .max(200)
  .optional();
export const editorialContent = aiWordSchema.extend({
  partOfSpeech: z.enum([
    "Noun",
    "Verb",
    "Adjective",
    "Adverb",
    "Preposition",
    "Conjunction",
    "Pronoun",
    "Phrase",
    "Article",
    "Determiner",
    "Modal Verb",
    "Auxiliary Verb",
    "Numeral",
    "Interjection",
  ]),
  pronunciationUk: audio,
  pronunciationUs: audio,
  ipaUk: z.string().trim().max(120).optional(),
  ipaUs: z.string().trim().max(120).optional(),
  examples: aiWordSchema.shape.examples.element
    .extend({ difficulty: z.enum(["easy", "medium", "yds"]) })
    .array()
    .length(5),
});
export const editorialSource = z.discriminatedUnion("license", [
  z
    .object({ license: z.literal("Atlas Original"), source: z.enum(["editor", "ai-reviewed"]) })
    .strict(),
  z
    .object({
      license: z.literal("CC BY-SA 4.0"),
      source: z.url({ protocol: /^https$/ }),
      attribution: z.string().trim().min(1).max(300),
    })
    .strict(),
]);
export const editorialItem = z
  .object({
    entryId: z.uuid().nullable(),
    revision: z.number().int().nonnegative(),
    content: editorialContent,
    provenance: editorialSource,
    legacy: z
      .object({
        id: z.uuid(),
        revision: z.number().int().positive(),
        digest: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict()
      .optional(),
  })
  .strict();
export const editorialCommand = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("publish"),
      operation: z.uuid(),
      items: z.array(editorialItem).min(1).max(20),
    })
    .strict(),
  z
    .object({
      action: z.literal("quarantine"),
      operation: z.uuid(),
      entryId: z.uuid(),
      revision: z.number().int().positive(),
      reason: z.string().trim().min(1).max(160),
    })
    .strict(),
  z
    .object({
      action: z.literal("restore"),
      operation: z.uuid(),
      entryId: z.uuid(),
      revision: z.number().int().positive(),
      target: z.number().int().positive(),
      reason: z.string().trim().min(1).max(160),
    })
    .strict(),
]);
