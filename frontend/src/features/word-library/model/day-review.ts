import type { WordEntry } from "@yds-atlas/shared";
import { createSession } from "@/features/learning-game/model/game-engine";
import type { GameSession } from "@/features/learning-game/model/game-session";
import { startMatchingBoard } from "@/features/learning-game/model/matching-engine";

export const DAY_REVIEW_ROUND_SIZE = 10;

/** Review stays in React memory and never writes storage, scores or the cloud. */
export function createDayReviewRounds(
  words: readonly WordEntry[],
  previousIds: readonly string[] = [],
  random: () => number = Math.random,
): WordEntry[][] {
  const shuffled = [...words];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  if (shuffled.length > 1 && shuffled.every((word, i) => word.id === previousIds[i])) {
    shuffled.push(shuffled.shift()!);
  }
  const rounds: WordEntry[][] = [];
  for (let i = 0; i < shuffled.length; i += DAY_REVIEW_ROUND_SIZE) {
    rounds.push(shuffled.slice(i, i + DAY_REVIEW_ROUND_SIZE));
  }
  return rounds;
}

export function dayReviewMissingMeanings(words: readonly WordEntry[]): WordEntry[] {
  return words.filter((word) => !word.meanings.some((meaning) => meaning.trim().length > 0));
}

/** Synthetic matching session is never passed to the persistent game component. */
export function createDayReviewMatching(words: WordEntry[]): GameSession {
  const base = createSession(words, 10);
  return startMatchingBoard({
    ...base,
    phase: "matching",
    queue: words.map((word) => word.id),
    words,
  }, DAY_REVIEW_ROUND_SIZE);
}
