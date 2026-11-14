import type { DailyPlanSnapshot } from "@yds-atlas/shared";
import { scopedStorageKey } from "@/shared/lib/storage-scope";
import { storageKeys } from "@/shared/lib/storage-keys";
import { loadCloudDailyPlan } from "./daily-plan-cloud-api";
import {
  inspectDailyPlanSyncPreflight,
  type SyncPreflightResult,
} from "../model/daily-plan-sync-preflight";

/** Read-only snapshot of the CURRENT storage scope. Never call syncWords() here. */
export function readLocalDailyPlanForPreflight(storage: Pick<Storage, "getItem">): {
  snapshot: unknown | null;
  errors: string[];
} {
  const errors: string[] = [];
  function read(key: string): { present: boolean; value: unknown } {
    let raw: string | null;
    try {
      raw = storage.getItem(scopedStorageKey(key));
    } catch {
      errors.push(`Yerel depolama okunamadı: ${key}`);
      return { present: false, value: null };
    }
    if (raw === null) return { present: false, value: null };
    try {
      return { present: true, value: JSON.parse(raw) as unknown };
    } catch {
      errors.push(`Yerel depolama JSON hatası: ${key}`);
      return { present: true, value: null };
    }
  }
  const groups = read(storageKeys.dailyWordGroups);
  const excluded = read(storageKeys.dailyWordExclusions);
  const size = read(storageKeys.dailyPlanGroupSize);
  const initialized = read(storageKeys.dailyPlanInitialized);
  if (initialized.present && typeof initialized.value !== "boolean")
    errors.push("Günlük plan initialized bayrağı geçersiz.");
  if (!groups.present && !excluded.present && !size.present && initialized.value !== true)
    return { snapshot: null, errors };

  // Legacy local plan uses integer size; never silently coerce a corrupt value.
  const snapshot = {
    groupSize: size.present ? size.value : 20,
    assignments: groups.present ? groups.value : [],
    excludedWordIds: excluded.present ? excluded.value : [],
  } satisfies Record<keyof DailyPlanSnapshot, unknown>;
  return { snapshot, errors };
}

/** Explicit GET-only action for a future preview screen; does not run on app start. */
export async function previewDailyPlanSync(
  userId: string,
  knownWordIds: readonly string[],
  storage: Pick<Storage, "getItem">,
): Promise<SyncPreflightResult> {
  if (!userId.trim()) throw new Error("Cloud preflight için oturum gerekli.");
  const local = readLocalDailyPlanForPreflight(storage);
  // Do not even attempt cloud operations when the local store is unreadable.
  if (local.errors.length) {
    return inspectDailyPlanSyncPreflight({
      local: local.snapshot,
      cloud: { revision: 0, snapshot: null },
      knownWordIds,
      localReadErrors: local.errors,
    });
  }
  const cloud = await loadCloudDailyPlan(userId);
  return inspectDailyPlanSyncPreflight({
    local: local.snapshot,
    cloud,
    knownWordIds,
  });
}
