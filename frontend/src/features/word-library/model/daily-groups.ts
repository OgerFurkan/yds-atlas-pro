import { getWordGroup, type WordEntry } from "@yds-atlas/shared";
import { usableExamples } from "@/features/learning-game/model/game-engine";
import { hasAtlasTiers } from "./tiered-examples";

/** Scored study uses only unlearned words with enough material to play. */
export function isDayStudyReady(word: WordEntry) {
  return getWordGroup(word.score) !== "learned" && !missingStudyContent(word).length;
}

export function missingStudyContent(word: WordEntry) {
  const missing: ("meaning" | "examples")[] = [];
  if (!word.meanings.some((meaning) => meaning.trim())) missing.push("meaning");
  if (
    !hasAtlasTiers(word.examples) ||
    usableExamples({ ...word, examples: word.examples.slice(0, 5) }).length !== 5
  )
    missing.push("examples");
  return missing;
}

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

/**
 * Review is unscored practice over the whole day: learned words stay in, and
 * missing details are reported by the review panel instead of being dropped.
 */
export function reviewableWords(group: DailyGroup) {
  return group.words;
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

/** Persisted assignments contain word IDs, not duplicated word data. */
export interface DayAssignment {
  day: number;
  words: string[];
}

export function clampDailyGroupSize(size: number) {
  if (!Number.isFinite(size)) return DEFAULT_DAILY_GROUP_SIZE;
  return Math.min(MAX_DAILY_GROUP_SIZE, Math.max(MIN_DAILY_GROUP_SIZE, Math.round(size)));
}

// Persisted assignments break ties by ID; the legacy display-order fallback also considers spelling.
export function dailyPlanWordIds(words: readonly WordEntry[]) {
  return [...words]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map(({ id }) => id);
}

function creationOrder(first: WordEntry, second: WordEntry) {
  return (
    first.createdAt.localeCompare(second.createdAt) ||
    first.word.localeCompare(second.word) ||
    first.id.localeCompare(second.id)
  );
}

/**
 * Without assignments, keep the historical deterministic view for old callers/tests.
 * With assignments, NEVER re-pack words: moving/removing a word must not silently
 * move other words, and an unassigned word must remain outside the plan.
 */
export function buildDailyPlan(
  words: WordEntry[],
  groupSize: number = DEFAULT_DAILY_GROUP_SIZE,
  assignments?: ReadonlyArray<DayAssignment>,
): DailyPlan {
  const size = clampDailyGroupSize(groupSize);
  const ordered = [...words].sort(creationOrder);
  const byId = new Map(ordered.map((word) => [word.id, word]));
  const taken = new Set<string>();
  const byDay = new Map<number, WordEntry[]>();

  if (assignments) {
    for (const assignment of assignments) {
      if (
        !Number.isInteger(assignment.day) ||
        assignment.day < 1 ||
        assignment.day > DAILY_PLAN_DAYS
      )
        continue;
      const dayWords = byDay.get(assignment.day) ?? [];
      for (const id of assignment.words) {
        const entry = byId.get(id);
        if (!entry || taken.has(id)) continue;
        taken.add(id);
        dayWords.push(entry);
      }
      byDay.set(assignment.day, dayWords);
    }
  }

  const groups = Array.from({ length: DAILY_PLAN_DAYS }, (_, index): DailyGroup => {
    const dayWords = assignments
      ? (byDay.get(index + 1) ?? [])
      : ordered.slice(index * size, (index + 1) * size);
    let hard = 0;
    let review = 0;
    let learned = 0;
    for (const word of dayWords) {
      const group = getWordGroup(word.score);
      if (group === "hard") hard += 1;
      else if (group === "review") review += 1;
      else learned += 1;
    }
    const playableWords = dayWords.filter(isDayStudyReady);
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
