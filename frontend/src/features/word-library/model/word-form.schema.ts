import { cefrLevelSchema } from "@yds-atlas/shared";
import { z } from "zod";

export const wordFormSchema = z.object({
  word: z.string().trim().min(1, "İngilizce kelime alanı zorunludur.").max(120),
  alternatives: z.string(),
  meanings: z.string(),
  usageNote: z.string(),
  partOfSpeech: z.string(),
  cefr: cefrLevelSchema,
  score: z.number().int().min(0).max(100),
  examples: z.string(),
  sourceUrl: z.string(),
  pronunciationUk: z.string(),
  pronunciationUs: z.string(),
});

export type WordFormValues = z.infer<typeof wordFormSchema>;

export const emptyWordForm: WordFormValues = {
  word: "",
  alternatives: "",
  meanings: "",
  usageNote: "",
  partOfSpeech: "",
  cefr: "Belirtilmedi",
  score: 0,
  examples: "",
  sourceUrl: "",
  pronunciationUk: "",
  pronunciationUs: "",
};
