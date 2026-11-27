import { z } from "zod";

const draftExample = z
  .object({
    difficulty: z.enum(["easy", "medium", "yds"]),
    sentence: z.string().min(12).max(1000),
    translation: z.string().min(10).max(1000),
    translationFocus: z.array(z.string().min(1).max(120)).min(1).max(4),
  })
  .strict();
export const sentenceDraftResponseSchema = z
  .object({
    status: z.literal("draft"),
    word: z.string().min(2).max(45),
    examples: z.array(draftExample).length(5),
  })
  .strict()
  .superRefine((result, ctx) => {
    const expected = ["easy", "easy", "medium", "yds", "yds"];
    const seen = new Set<string>();
    result.examples.forEach((entry, index) => {
      if (entry.difficulty !== expected[index])
        ctx.addIssue({ code: "custom", message: "2/1/2 sırası geçersiz." });
      if (entry.translationFocus.some((part) => !entry.translation.includes(part)))
        ctx.addIssue({ code: "custom", message: "Çeviri vurgusu eksik." });
      if (seen.has(entry.sentence.toLocaleLowerCase("en")))
        ctx.addIssue({ code: "custom", message: "Tekrarlanan cümle." });
      seen.add(entry.sentence.toLocaleLowerCase("en"));
    });
  });

export type SentenceDraftResponse = z.infer<typeof sentenceDraftResponseSchema>;
