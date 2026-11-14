import { getWordGroup, type WordEntry } from "@yds-atlas/shared";
import { isGameReady } from "@/features/learning-game/model/game-engine";
import { dueReviews, type ReviewSchedule } from "@/features/review/model/spaced-repetition";
import type { DayAssignment } from "./daily-groups";

/** Phase 4A: read-only recommendations. No storage, network or AI side effects. */
export type SmartPlanKind = "due" | "difficult" | "new";

export interface SmartPlanTask {
  kind: SmartPlanKind;
  wordIds: string[];
  estimatedMinutes: number;
}

export interface SmartPlanCounts {
  due: number;
  difficult: number;
  new: number;
}

export interface SmartDailyPlan {
  activeDay: number;
  generatedAt: string;
  minutesAvailable: number;
  minutesPlanned: number;
  minutesRemaining: number;
  tasks: SmartPlanTask[];
  /** Eligible pool, including items that could not fit into the time budget. */
  available: SmartPlanCounts;
  /** Actual selection, without duplicate word IDs. */
  selected: SmartPlanCounts;
  /** Assigned current-day new words that need completion before game study. */
  needsEnrichment: string[];
  /** Scheduled due words without enough meaning data for a safe review. */
  needsReviewContent: string[];
}

export interface SmartPlanInput {
  words: readonly WordEntry[];
  schedules: readonly ReviewSchedule[];
  assignments: readonly DayAssignment[];
  excludedWordIds?: readonly string[];
  activeDay: number;
  minutesAvailable: number;
  now: Date;
}

const COST: Record<SmartPlanKind, number> = { due: 2, difficult: 3, new: 4 };
const BATCH_SIZE = 5;

function stableWordOrder(a: WordEntry, b: WordEntry): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/**
 * Priority: due reviews (including learned words) -> unscheduled difficult words
 * -> ready new words explicitly assigned to the active day.
 *
 * Future-due schedules are never pulled forward. Missing schedules are NOT
 * interpreted as due. Excluded word IDs do not appear in any recommendation.
 * Day assignments and review schedules are never written or reordered.
 * Costs are bounded planning estimates, not measured study durations.
 */
export function buildSmartDailyPlan(input: SmartPlanInput): SmartDailyPlan {
  const { now, activeDay, minutesAvailable } = input;
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid plan date");
  if (!Number.isInteger(activeDay) || activeDay < 1 || activeDay > 60)
    throw new Error("Invalid active day");
  if (!Number.isInteger(minutesAvailable) || minutesAvailable < 5 || minutesAvailable > 240)
    throw new Error("Invalid study duration");

  const excluded = new Set(input.excludedWordIds ?? []);
  const byId = new Map<string, WordEntry>();
  for (const word of input.words) {
    if (word.id.trim() && !byId.has(word.id)) byId.set(word.id, word);
  }
  const dayByWordId = new Map<string, number>();
  const activeDayIds: string[] = [];
  for (const assignment of input.assignments) {
    if (!Number.isInteger(assignment.day) || assignment.day < 1 || assignment.day > 60) continue;
    for (const id of assignment.words) {
      if (dayByWordId.has(id)) continue;
      dayByWordId.set(id, assignment.day);
      if (assignment.day === activeDay) activeDayIds.push(id);
    }
  }

  const due: string[] = [];
  const seenDue = new Set<string>();
  const needsReviewContent: string[] = [];
  for (const item of dueReviews(input.schedules, now)) {
    const word = byId.get(item.wordId);
    if (!word || excluded.has(item.wordId) || seenDue.has(item.wordId)) continue;
    seenDue.add(item.wordId);
    // A due review of a learned word is still due, even if the game engine
    // currently considers that word outside its score<80 game-ready pool.
    if (word.meanings.some((meaning) => meaning.trim())) due.push(item.wordId);
    else needsReviewContent.push(item.wordId);
  }

  // Any schedule that is not due yet must retain its scheduled review date.
  const scheduled = new Set(input.schedules.map((item) => item.wordId));
  const difficult = [...byId.values()]
    .filter((word) =>
      !excluded.has(word.id) && !scheduled.has(word.id) &&
      getWordGroup(word.score) !== "learned" &&
      // Unseen words in the active group belong to the new-word stage.
      !(word.score === 0 && dayByWordId.get(word.id) === activeDay) &&
      // Only previously or currently assigned words can be catch-up work.
      // Unassigned words must stay outside the daily-plan recommendation.
      dayByWordId.has(word.id) &&
      dayByWordId.get(word.id)! <= activeDay &&
      isGameReady(word),
    )
    .sort((a, b) => a.score - b.score || stableWordOrder(a, b))
    .map((word) => word.id);

  const newWords: string[] = [];
  const needsEnrichment: string[] = [];
  for (const id of activeDayIds) {
    const word = byId.get(id);
    if (!word || excluded.has(id) || scheduled.has(id) || word.score !== 0) continue;
    if (isGameReady(word)) newWords.push(id);
    else needsEnrichment.push(id);
  }

  const available: SmartPlanCounts = {
    due: due.length, difficult: difficult.length, new: newWords.length,
  };
  const selected: SmartPlanCounts = { due: 0, difficult: 0, new: 0 };
  const tasks: SmartPlanTask[] = [];
  let remaining = minutesAvailable;

  for (const [kind, pool] of [
    ["due", due], ["difficult", difficult], ["new", newWords],
  ] as const) {
    const cost = COST[kind];
    const fits = Math.min(pool.length, Math.floor(remaining / cost));
    selected[kind] = fits;
    for (let start = 0; start < fits; start += BATCH_SIZE) {
      const wordIds = pool.slice(start, start + BATCH_SIZE);
      tasks.push({ kind, wordIds, estimatedMinutes: wordIds.length * cost });
    }
    remaining -= fits * cost;
  }

  return {
    activeDay,
    generatedAt: now.toISOString(),
    minutesAvailable,
    minutesPlanned: minutesAvailable - remaining,
    minutesRemaining: remaining,
    tasks,
    available,
    selected,
    needsEnrichment,
    needsReviewContent,
  };
}
