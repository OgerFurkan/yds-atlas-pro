import {
  wordInputSchema,
  type AiWordResponse,
  type WordInput,
  type WordPartOfSpeech,
} from "@yds-atlas/shared";
import { aiSuggestionToWordInput } from "../api/ai-word-api";

/** One headword can have several grammatical senses; the first/primary sense powers legacy games. */
export function combineWordSenses(
  responses: AiWordResponse[],
  included: WordPartOfSpeech[],
  preferredPrimary?: WordPartOfSpeech,
): WordInput {
  const selected = responses.filter((response) => included.includes(response.suggestion.partOfSpeech));
  if (!selected.length) throw new Error("Kaydetmek için en az bir kelime türü seç.");
  const unique = new Set(selected.map((response) => response.suggestion.partOfSpeech));
  if (unique.size !== selected.length) throw new Error("Aynı kelime türü iki kez eklenemez.");
  const primary = selected.find((response) => response.suggestion.partOfSpeech === preferredPrimary) ?? selected[0];
  const primaryInput = aiSuggestionToWordInput(primary.suggestion, primary.model, primary.dictionarySource);
  const senses = selected.map((response) => {
    const item = aiSuggestionToWordInput(response.suggestion, response.model, response.dictionarySource);
    return {
      partOfSpeech: response.suggestion.partOfSpeech,
      meanings: item.meanings,
      usageNote: item.usageNote,
      cefr: item.cefr,
      examples: item.examples,
    };
  });
  return wordInputSchema.parse({ ...primaryInput, senses });
}
