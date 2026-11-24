import type { AccountState } from "@yds-atlas/shared";
import { removeStorage, writeRawStorage, writeStorage } from "@/shared/lib/storage";
import { storageKeys } from "@/shared/lib/storage-keys";
export function cacheAccount(state: AccountState, includeSession = false, owner?: string | null) {
  writeRawStorage(storageKeys.dailyGoal, String(state.dailyGoal), owner);
  const progress: Record<string, string[]> = {};
  for (const item of state.progress) {
    progress[item.day] ??= [];
    progress[item.day].push(item.word_id);
  }
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
    if (state.session && !state.session.snapshot.discarded)
      writeStorage(storageKeys.gameSession, state.session.snapshot, owner);
    else removeStorage(storageKeys.gameSession, owner);
  }
}
