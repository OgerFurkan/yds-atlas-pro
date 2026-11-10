import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { wordEntrySchema, type AccountState, type GameSession } from "@yds-atlas/shared";
import { useWordLibrary } from "@/features/word-library/hooks/use-word-library";
import { remoteWordRepository } from "@/features/word-library/api/word-api";
import { setDailyGoal } from "@/features/dashboard/model/daily-progress";
import { getStorageScope } from "@/shared/lib/storage-scope";
import { storageKeys } from "@/shared/lib/storage-keys";
import type { Notify } from "@/shared/lib/notify";
import type { createAccountApi } from "../api/account-api";
import { cacheAccount } from "../model/account-cache";
import { SessionSync } from "../model/session-sync";
export function useAccountData(
  userId: string | undefined,
  api: ReturnType<typeof createAccountApi> | null,
  initial: AccountState | null,
  notify: Notify,
) {
  const repository = useMemo(() => (userId ? remoteWordRepository(userId) : undefined), [userId]);
  const library = useWordLibrary(repository);
  const reloadLibrary = library.reload;
  const [sync] = useState(() => (api ? new SessionSync(api, initial?.session) : null));
  const alive = useRef(true);
  const goalQueue = useRef<Promise<void>>(Promise.resolve());
  const goalVersion = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const current = useCallback(
    () => alive.current && getStorageScope() === (userId ?? null),
    [userId],
  );
  const persist = useCallback(
    async (snapshot: GameSession) => {
      if (sync) {
        sync.retry();
        await sync.save(snapshot);
      }
    },
    [sync],
  );
  const complete = useCallback(
    async (snapshot: GameSession) => {
      if (!api || !sync) return;
      await sync.flush();
      await api.completeSession(snapshot.id);
      await reloadLibrary();
      const state = await api.load();
      if (current()) cacheAccount(state, false, userId);
    },
    [api, sync, reloadLibrary, current, userId],
  );
  async function saveGoal(goal: number) {
    const version = ++goalVersion.current;
    const saved = api
      ? goalQueue.current.catch(() => {}).then(() => api.saveGoal(goal))
      : Promise.resolve();
    goalQueue.current = saved;
    try {
      await saved;
      return current();
    } catch {
      if (!current() || goalVersion.current !== version) return false;
      notify.error("Hedefin buluta kaydedilemedi. Yeniden dene.");
      try {
        const state = await api?.load();
        if (current() && state && goalVersion.current === version) {
          setDailyGoal(state.dailyGoal);
          window.dispatchEvent(new Event("storage"));
        }
      } catch {
        /* Keep the visible error; no silent write to a different account. */
      }
      return false;
    }
  }
  async function importGuest() {
    const guest = wordEntrySchema
      .array()
      .parse(JSON.parse(localStorage.getItem(storageKeys.words) ?? "[]"));
    if (!guest.length) throw new Error("Bu cihazda aktarılacak misafir kelimesi yok.");
    for (let index = 0; index < guest.length; index += 500)
      await library.addMany(guest.slice(index, index + 500));
  }
  return {
    library,
    persist: api ? persist : undefined,
    complete: api ? complete : undefined,
    saveGoal,
    importGuest: userId ? importGuest : undefined,
  };
}
