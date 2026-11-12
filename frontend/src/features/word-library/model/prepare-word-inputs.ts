import { type AiWordListResponse, type WordInput, wordInputSchema } from "@yds-atlas/shared";
import { escapeRegExp } from "@/shared/lib/regexp";
import { aiSuggestionToWordInput } from "../api/ai-word-api";
import { enrichWordInput } from "../data/starter-vocabulary";
import { wordKey } from "./word-normalization";

export type WordFillProgress = {
  /** Words already returned by Gemini. */
  completed: number;
  /** Words that actually need AI completion, not the whole submitted list. */
  total: number;
  /** Requests are sent in groups of this size. */
  batchSize: number;
  /** Names of missing AI-generated words. */
  failedWords?: string[];
};

export async function prepareWordInputs(
  inputs: WordInput[],
  existing: { word: string }[],
  complete: (words: string[]) => Promise<AiWordListResponse>,
  onProgress?: (progress: WordFillProgress) => void,
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
  const batchSize = 5;
  const results = new Map<string, ReturnType<typeof aiSuggestionToWordInput>>();
  if (names.length) onProgress?.({ completed: 0, total: names.length, batchSize });
  let firstFailure: unknown;
  for (let index = 0; index < names.length; index += batchSize) {
    const group = names.slice(index, index + batchSize);
    let response: AiWordListResponse;
    try {
      // The server validates each entry and retries missing headwords once.
      response = await complete(group);
    } catch (error) {
      firstFailure ??= error;
      // Stop on provider failure (quota/timeout/etc.) to avoid wasting API calls.
      break;
    }
    const sources = new Map(
      (response.dictionarySources ?? []).map((source) => [wordKey(source.word), source]),
    );
    const expected = new Set(group.map(wordKey));
    for (const suggestion of response.suggestions) {
      const key = wordKey(suggestion.word);
      // A response containing a foreign/duplicate word must never overwrite
      // user data or add the word to the current study batch.
      if (!expected.delete(key)) continue;
      try {
        results.set(key, aiSuggestionToWordInput(suggestion, response.model, sources.get(key)));
      } catch {
        // Reject only the malformed word, not previously validated entries.
      }
    }
    onProgress?.({
      completed: results.size,
      total: names.length,
      batchSize,
      ...(names.slice(0, index + group.length).some((name) => !results.has(wordKey(name)))
        ? { failedWords: names.slice(0, index + group.length).filter((name) => !results.has(wordKey(name))) }
        : {}),
    });
  }

  const failedWords = names.filter((name) => !results.has(wordKey(name)));
  if (failedWords.length) {
    onProgress?.({ completed: results.size, total: names.length, batchSize, failedWords });
  }
  // Keep already-complete entries and the AI-validated subset. Never persist
  // an incomplete new word merely because Gemini could not enrich it.
  const safePrepared = prepared.filter((input) => {
    const key = wordKey(input.word);
    return !missing.has(key) || results.has(key);
  });
  if (!safePrepared.length && firstFailure) throw firstFailure;
  if (!safePrepared.length && missing.size)
    throw new Error("AI hiçbir kelimeyi güvenle tamamlayamadı. Tekrar dene.");

  return safePrepared.map((input) => {
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
