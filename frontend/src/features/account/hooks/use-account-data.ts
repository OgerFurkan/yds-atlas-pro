import { type GameSession, wordEntrySchema } from "@yds-atlas/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readSession, sameSession } from "@/features/learning-game/task-storage";
import { withLocalWordWrite } from "@/features/word-library/api/local-word-repository";
import { remoteWordRepository } from "@/features/word-library/api/word-api";
import { useWordLibrary } from "@/features/word-library/hooks/use-word-library";
import { ApiError } from "@/shared/api/api-client";
import { readDailyGoal, setDailyGoal } from "@/shared/lib/daily-progress";
import type { Notify } from "@/shared/lib/notify";
import { hasPendingLocalChanges, readStoredText, writeStorage } from "@/shared/lib/storage";
import { storageKeys } from "@/shared/lib/storage-keys";
import { getStorageScope } from "@/shared/lib/storage-scope";
import type { createAccountApi } from "../api/account-api";
import { type AccountBootstrap, cacheAccount } from "../model/account-cache";
import { SessionSync } from "../model/session-sync";
export function useAccountData(
  userId: string | undefined,
  api: ReturnType<typeof createAccountApi> | null,
  initial: AccountBootstrap | null,
  notify: Notify,
) {
  const repository = useMemo(() => (userId ? remoteWordRepository(userId) : undefined), [userId]);
  const library = useWordLibrary(repository);
  const reloadLibrary = library.reload;
  const [sync] = useState(() =>
    api ? new SessionSync(api, initial?.session, initial?.draftRevision) : null,
  );
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
        if (current() && !snapshot.discarded)
          await withLocalWordWrite(() => {
            if (!current() || readSession()?.id !== snapshot.id) return;
            writeStorage(storageKeys.sessionRevision, [snapshot.id, sync.revision(snapshot.id)]);
            if (sameSession(readSession(), snapshot))
              writeStorage(storageKeys.pendingSession, null);
          });
      }
    },
    [sync, current],
  );
  const refreshProgress = useCallback(async () => {
    if (!api || !current()) return;
    await reloadLibrary();
    const state = await api.load();
    if (current())
      await withLocalWordWrite(() => {
        if (current()) cacheAccount(state, false, userId);
      });
  }, [api, current, reloadLibrary, userId]);
  const complete = useCallback(
    async (snapshot: GameSession) => {
      if (!api || !sync) throw new Error("Oturum bağlantısı kullanılamıyor.");
      try {
        await sync.flush();
      } catch {
        sync.retry();
      }
      if (!current() || !sameSession(readSession(), snapshot))
        throw new Error("Oturum değişti. Güncel çalışmayı yeniden aç.");
      if (!sync.hasSaved(snapshot)) await sync.save(snapshot);
      const result = await api.completeSession(snapshot.id, sync.revision(snapshot.id));
      await refreshProgress();
      return result;
    },
    [api, sync, refreshProgress, current],
  );
  async function saveGoal(goal: number, previous: number) {
    const version = ++goalVersion.current;
    const saved = goalQueue.current
      .catch(() => {})
      .then(async () => {
        if (!current()) return;
        if (api) await api.saveGoal(goal);
        if (!current()) return;
        await withLocalWordWrite(() => {
          if (!current()) return;
          if (!api && readDailyGoal() !== previous)
            throw new Error("Günlük hedef başka bir sekmede değişti. Güncel değeri kontrol et.");
          setDailyGoal(goal);
        });
      });
    goalQueue.current = saved;
    try {
      await saved;
      return current() && goalVersion.current === version;
    } catch (error) {
      if (!current() || goalVersion.current !== version) return false;
      notify.error(error instanceof Error ? error.message : "Günlük hedef kaydı doğrulanamadı.");
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
    if (hasPendingLocalChanges(null))
      throw new Error("Önce misafir profilindeki yarım kalan kaydı tamamla.");
    const original = readStoredText(storageKeys.words, null);
    const guest = wordEntrySchema.array().parse(JSON.parse(original ?? "[]"));
    if (!repository || !current()) throw new Error("Hesap değişti. Aktarım durduruldu.");
    if (
      guest.some((word) => !word.id.trim()) ||
      new Set(guest.map((word) => word.id)).size !== guest.length
    )
      throw new Error("Misafir kelimelerinin kimlikleri doğrulanamadı.");
    if (!guest.length) throw new Error("Bu cihazda aktarılacak misafir kelimesi yok.");
    function verifySource() {
      if (!current()) throw new Error("Hesap değişti. Aktarım durduruldu.");
      if (hasPendingLocalChanges(null) || readStoredText(storageKeys.words, null) !== original)
        throw new Error("Misafir kütüphanesi değişti. Güncel kelimelerle aktarımı yeniden dene.");
    }
    try {
      let batchSize = 500;
      for (let index = 0; index < guest.length; ) {
        verifySource();
        const batch = guest.slice(index, index + batchSize);
        try {
          const { added, duplicates } = await repository.addMany(batch);
          if (
            !Number.isSafeInteger(added) ||
            added < 0 ||
            !Number.isSafeInteger(duplicates) ||
            duplicates < 0 ||
            added + duplicates !== batch.length
          )
            throw new Error("Aktarımın tamamı doğrulanamadı. Misafir kopyası korundu.");
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 413 || batch.length < 2) throw error;
          batchSize = Math.ceil(batch.length / 2);
          continue;
        }
        index += batch.length;
      }
      verifySource();
    } finally {
      if (current()) await reloadLibrary();
    }
  }
  return {
    library,
    refreshProgress,
    persist: api ? persist : undefined,
    complete: api ? complete : undefined,
    saveGoal,
    importGuest: userId ? importGuest : undefined,
  };
}
