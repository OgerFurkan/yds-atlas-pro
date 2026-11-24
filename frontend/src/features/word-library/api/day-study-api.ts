import type { WordEntry, WordInput } from "@yds-atlas/shared";
import {
  inspectFromPool,
  inspectorToWordInput,
} from "@/features/word-inspector/api/word-inspector-api";
import { ApiError } from "@/shared/api/api-client";
import { reportWordAiUnavailable } from "@/shared/hooks/use-ai-health";
import { isDayStudyReady } from "../model/daily-groups";
import { mergeDayStudyWord } from "../model/day-study-preparation";
import { wordKey } from "../model/word-normalization";
import { aiSuggestionToWordInput, completeWordsWithGemini } from "./ai-word-api";

type Phase = "checking" | "generating" | "saving";

/** Requests are scoped to one owner and saves are compare-and-set against the original row. */
export async function prepareDayStudy(
  words: readonly WordEntry[],
  owner: string,
  signal: AbortSignal,
  save: (word: WordInput, id: string, expectedUpdatedAt: string) => Promise<WordEntry>,
  progress: (phase: Phase, prepared: number) => void,
) {
  const saved: WordEntry[] = [];
  const pending: WordEntry[] = [];
  let issue = "";
  async function persist(word: WordEntry, input: WordInput) {
    signal.throwIfAborted();
    progress("saving", saved.length);
    const entry = await save(input, word.id, word.updatedAt);
    signal.throwIfAborted();
    if (entry.id !== word.id || !isDayStudyReady(entry)) return;
    saved.push(entry);
    progress("saving", saved.length);
  }
  for (const word of words) {
    signal.throwIfAborted();
    if (word.lexicon) continue;
    progress("checking", saved.length);
    let poolInput: WordInput | null = null;
    try {
      const result = await inspectFromPool(
        { word: word.word, partOfSpeech: word.partOfSpeech || undefined },
        owner,
        AbortSignal.any([signal, AbortSignal.timeout(6_000)]),
      );
      if (result.status === "ready") {
        const input = inspectorToWordInput(result.entry);
        poolInput = mergeDayStudyWord(word, {
          ...input,
          examples: input.examples?.map((example) => ({
            ...example,
            source: `Atlas Lexicon · ${result.entry.id} · r${result.entry.revision}`,
          })),
        });
      }
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof ApiError && (error.status === 401 || error.status === 409))
        return { saved, issue: error.message };
    }
    if (!poolInput) pending.push(word);
    else {
      try {
        await persist(word, poolInput);
      } catch (error) {
        signal.throwIfAborted();
        issue = error instanceof Error ? error.message : String(error);
      }
    }
  }
  for (let index = 0; index < pending.length; index += 5) {
    signal.throwIfAborted();
    const batch = pending.slice(index, index + 5);
    progress("generating", saved.length);
    try {
      const response = await completeWordsWithGemini(
        batch.map(({ word }) => word),
        signal,
        owner,
      );
      signal.throwIfAborted();
      const listed = new Map(response.suggestions.map((word) => [wordKey(word.word), word]));
      for (const word of batch) {
        signal.throwIfAborted();
        const match = listed.get(wordKey(word.word));
        if (!match) continue;
        try {
          const source = response.dictionarySources?.find(
            (item) => wordKey(item.word) === wordKey(word.word),
          );
          const input = mergeDayStudyWord(
            word,
            aiSuggestionToWordInput(match, response.model, source),
          );
          if (input) await persist(word, input);
        } catch (error) {
          signal.throwIfAborted();
          issue = error instanceof Error ? error.message : String(error);
        }
      }
    } catch (error) {
      signal.throwIfAborted();
      issue = error instanceof Error ? error.message : String(error);
      if (error instanceof ApiError && [0, 408, 429, 502, 503, 504].includes(error.status))
        reportWordAiUnavailable(issue, error.status === 429 ? "cooldown" : "offline");
      break;
    }
  }
  return { saved, issue };
}
