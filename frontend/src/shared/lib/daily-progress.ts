import { DEFAULT_DAILY_GOAL } from "@yds-atlas/shared";
import { z } from "zod";
import { localDateKey } from "./istanbul-date";
import {
  readRawStorage,
  readStoredJson,
  readStoredText,
  writeRawStorage,
  writeStorage,
} from "./storage";
import { storageKeys } from "./storage-keys";

export const DAILY_GOAL_MIN = 10;
export const DAILY_GOAL_MAX = 100;
export const DAILY_GOAL_STEP = 10;

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

export function readDailyGoal() {
  const raw = readStoredText(storageKeys.dailyGoal);
  if (raw === null) return DEFAULT_DAILY_GOAL;
  const goal = Number(raw);
  if (goal !== normalizeDailyGoal(goal))
    throw new Error("Günlük hedef doğrulanamadı. Özgün kayıt korundu.");
  return goal;
}

export function setDailyGoal(value: number) {
  const goal = normalizeDailyGoal(value);
  writeRawStorage(storageKeys.dailyGoal, String(goal));
  return goal;
}

export function stepDailyGoal(current: number, step: number) {
  return Math.max(DAILY_GOAL_MIN, Math.min(DAILY_GOAL_MAX, current + step * DAILY_GOAL_STEP));
}

const dayKey = z.iso.date();
const historySchema = z.record(dayKey, z.array(z.string().min(1)));
const targetsSchema = z.record(dayKey, z.number().int().min(10).max(100).multipleOf(10));
const daysSchema = z.record(dayKey, z.boolean());
const read = <T>(key: string, schema: z.ZodType<T>): T => {
  const value = readStoredJson(key);
  const result = schema.safeParse(value === undefined ? {} : value);
  if (!result.success) throw new Error("Öğrenme geçmişi doğrulanamadı. Özgün kayıt korundu.");
  return result.data;
};

export function progressHistory() {
  return read(storageKeys.dailyProgress, historySchema);
}
export function goalHistory() {
  return read(storageKeys.goalPerDay, targetsSchema);
}
export function completedDays() {
  return read(storageKeys.completedDays, daysSchema);
}

export function completedToday() {
  return progressHistory()[localDateKey()]?.length ?? 0;
}

export function recordDailyProgress(wordIds: string[]) {
  const history = read(storageKeys.dailyProgress, historySchema);
  const targets = read(storageKeys.goalPerDay, targetsSchema);
  const days = read(storageKeys.completedDays, daysSchema);
  const goal = readDailyGoal();
  const today = localDateKey();
  const ids = [...new Set([...(history[today] ?? []), ...wordIds])];
  if (!days[today]) writeStorage(storageKeys.goalPerDay, { ...targets, [today]: goal });
  writeStorage(storageKeys.dailyProgress, { ...history, [today]: ids });
  if (ids.length >= goal) writeStorage(storageKeys.completedDays, { ...days, [today]: true });
}

export function completedOn(date: Date) {
  return progressHistory()[localDateKey(date)]?.length ?? 0;
}
