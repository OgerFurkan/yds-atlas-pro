import type { WordEntry, WordInput } from "@yds-atlas/shared";
import { starterVocabulary } from "@/features/word-library/data/starter-vocabulary";
import { wordKey } from "@/features/word-library/model/word-normalization";
import { isGameReady, shuffle } from "./game-engine";

export type SetupSource = "starter" | "library" | "own" | "ai";

export function setupCandidates(
  words: WordEntry[],
  source: SetupSource,
  ownKeys: string[],
): WordInput[] {
  const ready = words.filter(isGameReady);
  if (source === "library") return ready;
  if (source === "own") return ready.filter((word) => ownKeys.includes(wordKey(word.word)));
  return starterVocabulary.filter(
    (seed) => !words.some((word) => wordKey(word.word) === wordKey(seed.word) && word.score >= 80),
  );
}

export function taskGroups(count: number, batch: 5 | 10) {
  return Math.ceil(count / batch);
}

export function taskGroupCount(target: number, candidateCount: number, batch: 5 | 10) {
  return taskGroups(Math.min(target, candidateCount), batch);
}

export function selectTaskWords(candidates: WordInput[], target: number, short = false) {
  return shuffle(candidates).slice(0, short ? candidates.length : target);
}

/** Re-reads the saved records so a task always starts from stored, complete words. */
export function alignChosenWords(selected: Pick<WordInput, "word">[], libraryWords: WordEntry[]) {
  const selectedKeys = new Set(selected.map((word) => wordKey(word.word)));
  return libraryWords.filter((word) => selectedKeys.has(wordKey(word.word)) && isGameReady(word));
}
