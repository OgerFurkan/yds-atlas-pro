import { readRawStorage, readStorage, writeRawStorage, writeStorage } from "@/shared/lib/storage";
import { storageKeys } from "@/shared/lib/storage-keys";
import { localDateKey } from "./date";

export const DAILY_GOAL_MIN = 10;
export const DAILY_GOAL_MAX = 100;
export const DAILY_GOAL_STEP = 10;
export const DEFAULT_DAILY_GOAL = 20;

export const dailyGoalOptions = Array.from(
  { length: (DAILY_GOAL_MAX - DAILY_GOAL_MIN) / DAILY_GOAL_STEP + 1 },
  (_, index) => DAILY_GOAL_MIN + index * DAILY_GOAL_STEP,
);

export function normalizeDailyGoal(value: number) {
  return Number.isInteger(value) &&
    value >= DAILY_GOAL_MIN &&
    value <= DAILY_GOAL_MAX &&
    value % DAILY_GOAL_STEP === 0
    ? value
    : DEFAULT_DAILY_GOAL;
}

export function dailyGoal() {
  return normalizeDailyGoal(Number(readRawStorage(storageKeys.dailyGoal)));
}

export function setDailyGoal(value: number) {
  const goal = normalizeDailyGoal(value);
  writeRawStorage(storageKeys.dailyGoal, String(goal));
  return goal;
}

export function stepDailyGoal(current: number, step: number) {
  return Math.max(DAILY_GOAL_MIN, Math.min(DAILY_GOAL_MAX, current + step * DAILY_GOAL_STEP));
}

export function completedToday() {
  return (
    readStorage<Record<string, string[]>>(storageKeys.dailyProgress, {})[localDateKey()]?.length ??
    0
  );
}

export function recordDailyProgress(wordIds: string[]) {
  const history = readStorage<Record<string, string[]>>(storageKeys.dailyProgress, {});
  const today = localDateKey();
  const targets = readStorage<Record<string, number>>(storageKeys.goalPerDay, {});
  writeStorage(storageKeys.goalPerDay, { ...targets, [today]: dailyGoal() });
  writeStorage(storageKeys.dailyProgress, {
    ...history,
    [today]: [...new Set([...(history[today] ?? []), ...wordIds])],
  });
  const count = new Set([...(history[today] ?? []), ...wordIds]).size;
  if (count >= dailyGoal()) {
    const days = readStorage<Record<string, boolean>>(storageKeys.completedDays, {});
    writeStorage(storageKeys.completedDays, { ...days, [today]: true });
  }
}

export function completedOn(date: Date) {
  return (
    readStorage<Record<string, string[]>>(storageKeys.dailyProgress, {})[localDateKey(date)]
      ?.length ?? 0
  );
}
