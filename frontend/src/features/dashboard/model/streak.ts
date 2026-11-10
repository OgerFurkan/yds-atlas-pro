import { readStorage } from "@/shared/lib/storage";
import { storageKeys } from "@/shared/lib/storage-keys";
import { dailyGoal } from "./daily-progress";
import { dayOffset, localDateKey, startOfWeek, weekdayLabels } from "./date";

export const streakStorageKey = storageKeys.completedDays;

export function calculateStreak(completedKeys: string[], today: string) {
  const dates = [...new Set(completedKeys)]
    .filter((date) => date <= today && /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  const completed = new Set(dates);
  let cursor = completed.has(today) ? today : dayOffset(today, -1);
  let current = 0;
  while (completed.has(cursor)) {
    current++;
    cursor = dayOffset(cursor, -1);
  }
  let longest = 0;
  let run = 0;
  let previous = "";
  for (const date of dates) {
    run = previous && dayOffset(previous, 1) === date ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = date;
  }
  return { current, longest, completed };
}

export function getStreak(now = new Date()) {
  const today = localDateKey(now);
  const legacy = readStorage<Record<string, string[]>>(storageKeys.dailyProgress, {});
  const milestones = readStorage<Record<string, boolean>>(streakStorageKey, {});
  const targets = readStorage<Record<string, number>>(storageKeys.goalPerDay, {});
  const dates = [
    ...Object.keys(milestones).filter((date) => milestones[date]),
    ...Object.keys(legacy).filter((date) => {
      const target = targets[date] ?? (date === today ? dailyGoal() : null);
      return target !== null && (legacy[date]?.length ?? 0) >= target;
    }),
  ];
  const result = calculateStreak(dates, today);
  const monday = startOfWeek(today);
  const week = weekdayLabels.map((label, index) => {
    const date = dayOffset(monday, index);
    return {
      label,
      date,
      completed: result.completed.has(date),
      today: date === today,
      future: date > today,
    };
  });
  return { ...result, week, todayCompleted: result.completed.has(today) };
}
