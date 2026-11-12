import { getWordGroup, type WordEntry } from "@yds-atlas/shared";
import { isGameReady } from "@/features/learning-game/model/game-engine";

export const DAILY_PLAN_DAYS = 60;
export const MIN_DAILY_GROUP_SIZE = 10;
export const MAX_DAILY_GROUP_SIZE = 40;
export const DEFAULT_DAILY_GROUP_SIZE = 20;
export const dailyGroupSizes = [10, 20, 30, 40] as const;

export interface DailyGroup {
  day: number;
  words: WordEntry[];
  playableWords: WordEntry[];
  total: number;
  hard: number;
  review: number;
  learned: number;
  playable: number;
  progress: number;
}

export interface DailyPlan {
  groups: DailyGroup[];
  groupSize: number;
  totalWords: number;
  hard: number;
  review: number;
  learned: number;
  playable: number;
  activeDays: number;
  completedDays: number;
  overflow: number;
}

export interface DailyGroupPreset {
  day: number;
  wordIds: string[];
}

export function clampDailyGroupSize(size: number) {
  if (!Number.isFinite(size)) return DEFAULT_DAILY_GROUP_SIZE;
  return Math.min(MAX_DAILY_GROUP_SIZE, Math.max(MIN_DAILY_GROUP_SIZE, Math.round(size)));
}

function creationOrder(first: WordEntry, second: WordEntry) {
  return (
    first.createdAt.localeCompare(second.createdAt) ||
    first.word.localeCompare(second.word) ||
    first.id.localeCompare(second.id)
  );
}

/** Splits the library into readable day groups, capped at 60 days and 40 words per day. */
export function buildDailyPlan(
  words: WordEntry[],
  groupSize: number = DEFAULT_DAILY_GROUP_SIZE,
): DailyPlan {
  const size = clampDailyGroupSize(groupSize);
  const ordered = [...words].sort(creationOrder);
  const groups = Array.from({ length: DAILY_PLAN_DAYS }, (_, index): DailyGroup => {
    const dayWords = ordered.slice(index * size, (index + 1) * size);
    let hard = 0;
    let review = 0;
    let learned = 0;
    for (const word of dayWords) {
      const group = getWordGroup(word.score);
      if (group === "hard") hard += 1;
      else if (group === "review") review += 1;
      else learned += 1;
    }
    const playableWords = dayWords.filter(isGameReady);
    return {
      day: index + 1,
      words: dayWords,
      playableWords,
      total: dayWords.length,
      hard,
      review,
      learned,
      playable: playableWords.length,
      progress: dayWords.length ? learned / dayWords.length : 0,
    };
  });
  const totalWords = groups.reduce((total, group) => total + group.total, 0);
  return {
    groups,
    groupSize: size,
    totalWords,
    hard: groups.reduce((total, group) => total + group.hard, 0),
    review: groups.reduce((total, group) => total + group.review, 0),
    learned: groups.reduce((total, group) => total + group.learned, 0),
    playable: groups.reduce((total, group) => total + group.playable, 0),
    activeDays: groups.filter((group) => group.total > 0).length,
    completedDays: groups.filter((group) => group.total > 0 && group.learned === group.total)
      .length,
    overflow: words.length - totalWords,
  };
}
