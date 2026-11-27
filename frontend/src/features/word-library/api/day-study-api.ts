import { matchesRequestedSense, type WordEntry, type WordInput } from "@yds-atlas/shared";
import {
  inspectFromPool,
  inspectorToWordInput,
} from "@/features/word-inspector/api/word-inspector-api";
import { ApiError } from "@/shared/api/api-client";
import { reportWordAiUnavailable } from "@/shared/hooks/use-ai-health";
import { missingStudyContent } from "../model/daily-groups";
import { mergeDayStudyWord } from "../model/day-study-preparation";
import { errorReason, wordFailureReason } from "../model/prepare-word-inputs";
import { wordKey } from "../model/word-normalization";
import { aiSuggestionToWordInput, completeWordsWithGemini } from "./ai-word-api";

type Phase = "checking" | "generating" | "saving";

export async function lookupStudyContent(word: WordInput, owner: string, signal?: AbortSignal) {
  const lookup = (query: Parameters<typeof inspectFromPool>[0]) =>
    inspectFromPool(query, owner, signal);
  let result: Awaited<ReturnType<typeof inspectFromPool>>;
  try {
    result = await lookup({ word: word.word });
    if (result.status === "choices") {
      const matches = result.choices.filter(
        (choice) =>
          (!word.partOfSpeech || wordKey(word.partOfSpeech) === wordKey(choice.partOfSpeech)) &&
          (word.meanings ?? []).some((meaning) =>
            matchesRequestedSense({ meanings: [meaning] }, { meanings: [choice.meaning] }),
          ),
      );
      if (matches.length === 1) {
        const [choice] = matches;
        result = await lookup({
          word: word.word,
          partOfSpeech: choice.partOfSpeech,
          meaning: choice.meaning,
        });
      } else if (!word.meanings?.length || matches.length > 1) {
        throw new Error(
          "Birden çok sözlük anlamı bulundu. İstenen Türkçe anlamı ve kelime türünü belirt.",
        );
      }
    }
  } catch (error) {
    // Deployments without the optional Inspector still support explicit personal AI generation.
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
  if (
    result.status !== "ready" ||
    wordKey(result.entry.word) !== wordKey(word.word) ||
    !matchesRequestedSense(word, result.entry)
  )
    return null;
  return inspectorToWordInput(result.entry);
}

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
  const failures = new Map<string, string>();
  const fail = (word: WordEntry, reason: string) => failures.set(word.word, reason);
  const report = () => [...failures].map(([word, reason]) => word + " · " + reason).join("\n");
  async function persist(word: WordEntry, input: WordInput) {
    signal.throwIfAborted();
    progress("saving", saved.length);
    const entry = await save(input, word.id, word.updatedAt);
    signal.throwIfAborted();
    if (entry.id !== word.id || missingStudyContent(entry).length)
      throw new Error("Kelime kaydı doğrulanamadı.");
    saved.push(entry);
    progress("saving", saved.length);
  }
  for (const word of words) {
    signal.throwIfAborted();
    if (!missingStudyContent(word).length) continue;
    if (word.lexicon) {
      fail(word, "Bağlı sözlük içeriği eksik. Sözlük kaydının incelenmesi gerekiyor.");
      continue;
    }
    progress("checking", saved.length);
    let poolInput: WordInput | null = null;
    try {
      const input = await lookupStudyContent(
        word,
        owner,
        AbortSignal.any([signal, AbortSignal.timeout(6_000)]),
      );
      if (input) poolInput = mergeDayStudyWord(word, input);
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof ApiError && [401, 403, 409].includes(error.status)) {
        fail(word, error.message);
        for (const remaining of words)
          if (!saved.some((entry) => entry.id === remaining.id) && !failures.has(remaining.word))
            fail(remaining, "Önceki denetim durduğu için işlenmedi.");
        return { saved, issue: report() };
      }
      fail(word, errorReason(error));
      continue;
    }
    if (!poolInput) pending.push(word);
    else {
      try {
        await persist(word, poolInput);
      } catch (error) {
        signal.throwIfAborted();
        fail(word, errorReason(error));
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
        batch
          .filter((entry) => entry.meanings.length || entry.partOfSpeech)
          .map(({ word, meanings, partOfSpeech }) => ({
            word,
            meanings,
            partOfSpeech: partOfSpeech || undefined,
          })),
      );
      signal.throwIfAborted();
      const listed = new Map(response.suggestions.map((word) => [wordKey(word.word), word]));
      for (const word of batch) {
        signal.throwIfAborted();
        const match = listed.get(wordKey(word.word));
        if (!match) {
          fail(
            word,
            wordFailureReason[
              response.failures?.find((failure) => wordKey(failure.word) === wordKey(word.word))
                ?.reason ?? "missing"
            ],
          );
          continue;
        }
        try {
          const source = response.dictionarySources?.find(
            (item) => wordKey(item.word) === wordKey(word.word),
          );
          const input = mergeDayStudyWord(
            word,
            aiSuggestionToWordInput(match, response.model, source),
          );
          if (input) await persist(word, input);
          else fail(word, "Örnekler belirtilen anlam ve kelime türüyle doğrulanamadı.");
        } catch (error) {
          signal.throwIfAborted();
          fail(word, errorReason(error));
        }
      }
    } catch (error) {
      signal.throwIfAborted();
      const issue = errorReason(error);
      for (const word of batch) {
        const reason =
          error instanceof ApiError
            ? error.wordFailures?.find((failure) => wordKey(failure.word) === wordKey(word.word))
                ?.reason
            : undefined;
        fail(word, reason ? wordFailureReason[reason] : issue);
      }
      if (error instanceof ApiError && error.code === "AI_INVALID_RESPONSE") continue;
      for (const word of pending.slice(index + batch.length))
        fail(word, "Önceki istek durduğu için bu kelime gönderilmedi.");
      if (error instanceof ApiError && [0, 408, 429, 502, 503, 504].includes(error.status))
        reportWordAiUnavailable(issue, error.status === 429 ? "cooldown" : "offline");
      break;
    }
  }
  return { saved, issue: report() };
}
