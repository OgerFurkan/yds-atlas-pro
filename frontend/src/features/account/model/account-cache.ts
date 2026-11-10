import type { AccountState } from "@yds-atlas/shared";
import { storageKeys } from "@/shared/lib/storage-keys";
import { writeRawStorage, writeStorage, removeStorage } from "@/shared/lib/storage";
export function cacheAccount(state: AccountState, includeSession = false, owner?: string | null) {
  writeRawStorage(storageKeys.dailyGoal, String(state.dailyGoal), owner);
  const progress: Record<string, string[]> = {};
  for (const item of state.progress) (progress[item.day] ??= []).push(item.word_id);
  writeStorage(storageKeys.dailyProgress, progress, owner);
  writeStorage(
    storageKeys.completedDays,
    Object.fromEntries(state.completedDays.map((item) => [item.day, true])),
    owner,
  );
  writeStorage(
    storageKeys.goalPerDay,
    Object.fromEntries(state.completedDays.map((item) => [item.day, item.goal])),
    owner,
  );
  if (includeSession) {
    if (state.session) writeStorage(storageKeys.gameSession, state.session.snapshot, owner);
    else removeStorage(storageKeys.gameSession, owner);
  }
}
