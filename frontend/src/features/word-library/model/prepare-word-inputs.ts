import { type AiWordListResponse, type WordInput, wordInputSchema } from "@yds-atlas/shared";
import { escapeRegExp } from "@/shared/lib/regexp";
import { aiSuggestionToWordInput } from "../api/ai-word-api";
import { enrichWordInput } from "../data/starter-vocabulary";
import { wordKey } from "./word-normalization";

export async function prepareWordInputs(
  inputs: WordInput[],
  existing: { word: string }[],
  complete: (words: string[]) => Promise<AiWordListResponse>,
) {
  const known = new Set(existing.map((word) => wordKey(word.word)));
  const prepared = inputs.map((input) => wordInputSchema.parse(enrichWordInput(input)));
  const missing = new Map<string, string>();
  for (const word of prepared) {
    const key = wordKey(word.word);
    const forms = [word.word, ...word.alternatives].map(escapeRegExp);
    const pattern = new RegExp(`(^|[^a-z])(${forms.join("|")})(?=$|[^a-z])`, "i");
    if (
      !known.has(key) &&
      (!word.meanings.length ||
        !word.partOfSpeech ||
        word.cefr === "Belirtilmedi" ||
        !word.usageNote ||
        word.examples.filter((example) => example.translation && pattern.test(example.sentence))
          .length < 5)
    )
      missing.set(key, word.word);
  }
  if (missing.size > 25)
    throw new Error(
      "AI ile bir seferde en fazla 25 yeni kelime tamamlanabilir. Listeyi daha küçük gruplara ayır.",
    );
  const names = [...missing.values()];
  const results = new Map<string, ReturnType<typeof aiSuggestionToWordInput>>();
  for (let index = 0; index < names.length; index += 5) {
    const group = names.slice(index, index + 5);
    const response = await complete(group);
    const sources = new Map(
      (response.dictionarySources ?? []).map((source) => [wordKey(source.word), source]),
    );
    const expected = new Set(group.map(wordKey));
    for (const suggestion of response.suggestions) {
      const key = wordKey(suggestion.word);
      if (!expected.delete(key))
        throw new Error("AI farklı veya tekrarlanan bir kelime döndürdü. Tekrar dene.");
      results.set(key, aiSuggestionToWordInput(suggestion, response.model, sources.get(key)));
    }
    if (expected.size) throw new Error("AI bazı kelimeleri tamamlayamadı. Tekrar dene.");
  }
  return prepared.map((input) => {
    const generated = results.get(wordKey(input.word));
    if (!generated) return input;
    const sentences = new Set(
      input.examples.map((example) => example.sentence.trim().toLocaleLowerCase("en")),
    );
    return {
      ...input,
      sourceUrl: input.sourceUrl || generated.sourceUrl,
      meanings: input.meanings.length ? input.meanings : generated.meanings,
      usageNote: input.usageNote || generated.usageNote,
      partOfSpeech: input.partOfSpeech || generated.partOfSpeech,
      cefr: input.cefr === "Belirtilmedi" ? generated.cefr : input.cefr,
      alternatives: [...new Set([...input.alternatives, ...generated.alternatives])],
      examples: [
        ...input.examples,
        ...generated.examples.filter(
          (example) => !sentences.has(example.sentence.trim().toLocaleLowerCase("en")),
        ),
      ],
    };
  });
}
