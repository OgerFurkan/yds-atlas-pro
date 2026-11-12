import {
  type AiWordResponse,
  aiNamedWordsRequestSchema,
  aiWordListRequestSchema,
  aiWordListResponseSchema,
  aiWordRequestSchema,
  aiWordResponseSchema,
  type DictionarySource,
  wordInputSchema,
} from "@yds-atlas/shared";
import { apiRequest } from "@/shared/api/api-client";
import { recordAiIssue } from "@/shared/lib/ai-issues";

export async function enrichWithGemini(word: string, signal?: AbortSignal) {
  const request = aiWordRequestSchema.parse({ word });
  try {
    return aiWordResponseSchema.parse(
      await apiRequest("/api/ai/words/enrich", {
        method: "POST",
        body: JSON.stringify(request),
        signal,
      }),
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    recordAiIssue(error);
    throw error;
  }
}
export async function completeWordsWithGemini(words: string[]) {
  const request = aiNamedWordsRequestSchema.parse({ words });
  try {
    return aiWordListResponseSchema.parse(
      await apiRequest("/api/ai/words/complete", {
        method: "POST",
        body: JSON.stringify(request),
      }),
    );
  } catch (error) {
    recordAiIssue(error);
    throw error;
  }
}
export async function suggestWordsWithGemini(
  count: number,
  exclude: string[],
  signal?: AbortSignal,
) {
  const request = aiWordListRequestSchema.parse({ count, exclude });
  try {
    return aiWordListResponseSchema.parse(
      await apiRequest("/api/ai/words/suggest", {
        method: "POST",
        body: JSON.stringify(request),
        signal,
      }),
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    recordAiIssue(error);
    throw error;
  }
}
export function aiSuggestionToWordInput(
  suggestion: AiWordResponse["suggestion"],
  model: string,
  dictionarySource?: DictionarySource,
) {
  const dictionarySentences = new Set(
    dictionarySource?.examples.map((example) => example.sentence.trim()) ?? [],
  );
  return wordInputSchema.parse({
    ...suggestion,
    sourceUrl: dictionarySource?.sourceUrl,
    examples: suggestion.examples.map((example) => ({
      ...example,
      source: dictionarySentences.has(example.sentence.trim())
        ? `DictionaryAPI.dev / Wiktionary (${dictionarySource!.licenseName}): ${dictionarySource!.sourceUrl}`
        : "Gemini · " + model,
    })),
  });
}
