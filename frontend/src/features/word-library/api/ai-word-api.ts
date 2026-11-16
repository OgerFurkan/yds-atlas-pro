import {
  type AiWordResponse,
  aiNamedWordsRequestSchema,
  aiWordListRequestSchema,
  aiWordListResponseSchema,
  aiWordResponseSchema,
  lexiconResponseSchema,
  lexiconCandidatesResponseSchema,
  lexiconResolveRequestSchema,
  type DictionarySource,
  type WordPartOfSpeech,
  wordInputSchema,
} from "@yds-atlas/shared";
import { apiRequest } from "@/shared/api/api-client";
import { recordAiIssue } from "@/shared/lib/ai-issues";

export async function enrichWithGemini(word: string, signal?: AbortSignal, partOfSpeech?: WordPartOfSpeech, meaning?: string) {
  const request = lexiconResolveRequestSchema.parse({ word, partOfSpeech, meaning });
  try {
    const resolved=lexiconResponseSchema.parse(await apiRequest("/api/lexicon/resolve", {
      method:"POST",body:JSON.stringify(request),signal,
    }));
    const ref={entryId:resolved.entry.id,revision:resolved.entry.revision,contractVersion:1 as const};
    return aiWordResponseSchema.parse({
      suggestion:{...resolved.entry.content,lexicon:ref},
      provider:resolved.source==="pool" ? "Lexicon" : "Gemini",
      model:resolved.source==="pool" ? "atlas-lexicon-v1" :
        (typeof resolved.entry.provenance.model==="string" ? resolved.entry.provenance.model : "atlas-generated-word"),
      lexicon:{source:resolved.source,entryId:ref.entryId,revision:ref.revision},
    });
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
      await apiRequest("/api/lexicon/complete", {
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
      await apiRequest("/api/lexicon/suggest", {
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
export async function fetchLexiconCandidates(word: string) {
  return lexiconCandidatesResponseSchema.parse(await apiRequest(
    `/api/lexicon/candidates?word=${encodeURIComponent(word)}`));
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
    sourceUrl: dictionarySource?.sourceUrl ?? suggestion.sourceUrl,
    examples: suggestion.examples.map((example) => ({
      ...example,
      source: dictionarySentences.has(example.sentence.trim())
        ? `DictionaryAPI.dev / Wiktionary (${dictionarySource!.licenseName}): ${dictionarySource!.sourceUrl}`
        : suggestion.lexicon ? "Atlas Lexicon · r" + suggestion.lexicon.revision : "Gemini · " + model,
    })),
  });
}
