import type { GameSession, WordEdit, WordEntry, WordInput } from "@yds-atlas/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { completeGuestResult } from "@/features/learning-game/model/guest-result";
import { hasPendingLocalChanges } from "@/shared/lib/storage";
import { getStorageScope } from "@/shared/lib/storage-scope";
import {
  localWordRepository,
  MissingLocalWordsWithPlanSettings,
  recoverEmptyLibrary,
  withLocalWordWrite,
} from "../api/local-word-repository";
import { WordEditConflict, type WordRepository } from "../api/word-repository";
export function useWordLibrary(repository: WordRepository = localWordRepository) {
  const [words, setWords] = useState<WordEntry[]>([]);
  const cache = useRef(words);
  const verified = useRef<WordEntry[] | null>(null);
  const owner = useRef(getStorageScope());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [canRecoverEmpty, setCanRecoverEmpty] = useState(false);
  const generation = useRef(0);
  const alive = useRef(true);
  const sync = useCallback(async () => {
    const current = ++generation.current;
    verified.current = null;
    try {
      if (hasPendingLocalChanges()) await withLocalWordWrite(() => {});
      const entries = await repository.list();
      if (!alive.current || current !== generation.current || owner.current !== getStorageScope())
        return;
      verified.current = entries;
      cache.current = entries;
      setWords(entries);
      setLoadError("");
      setCanRecoverEmpty(false);
      setLoading(false);
    } catch (error) {
      if (alive.current && current === generation.current) {
        setLoadError(error instanceof Error ? error.message : "Kelimeler yüklenemedi.");
        setCanRecoverEmpty(
          repository === localWordRepository && error instanceof MissingLocalWordsWithPlanSettings,
        );
        setLoading(false);
      }
    }
  }, [repository]);
  async function recoverEmpty() {
    if (!canRecoverEmpty || !alive.current || owner.current !== null || getStorageScope() !== null)
      return;
    setCanRecoverEmpty(false);
    try {
      await withLocalWordWrite(() => {
        if (alive.current) recoverEmptyLibrary();
      });
    } catch (error) {
      if (alive.current && getStorageScope() === owner.current)
        setLoadError(error instanceof Error ? error.message : "Kütüphane oluşturulamadı.");
      return;
    }
    if (alive.current && getStorageScope() === owner.current) await sync();
  }
  useEffect(() => {
    alive.current = true;
    void Promise.resolve().then(sync);
    const listener = () => {
      void sync();
    };
    window.addEventListener("storage", listener);
    return () => {
      alive.current = false;
      window.removeEventListener("storage", listener);
    };
  }, [sync]);
  const verifyPlanWords = useCallback(
    (snapshot: WordEntry[]) => {
      if (!alive.current || getStorageScope() !== owner.current || verified.current !== snapshot)
        return false;
      if (repository === localWordRepository) {
        const current = localWordRepository.list();
        if (
          snapshot.length !== current.length ||
          current.some(
            (word, index) =>
              word.id !== snapshot[index].id ||
              word.createdAt !== snapshot[index].createdAt ||
              word.updatedAt !== snapshot[index].updatedAt,
          )
        )
          return false;
      }
      return true;
    },
    [repository],
  );
  function write<T>(perform: () => T) {
    if (!alive.current || owner.current !== getStorageScope() || !verified.current)
      throw new Error("Kelime listesi doğrulanamadı. Kütüphaneyi yeniden yükle.");
    if (repository !== localWordRepository) return perform();
    if (getStorageScope() !== null) throw new Error("Hesap değişti. İşlemi yeniden başlat.");
    return withLocalWordWrite(() => {
      if (!alive.current || owner.current !== getStorageScope())
        throw new Error("Hesap değişti. İşlemi yeniden başlat.");
      if (!verified.current)
        throw new Error("Kelime listesi doğrulanamadı. Kütüphaneyi yeniden yükle.");
      return perform();
    });
  }
  async function edit(patch: WordEdit, id: string, expectedUpdatedAt: string) {
    try {
      await write(() => repository.edit(patch, id, expectedUpdatedAt));
    } catch (error) {
      if (error instanceof WordEditConflict) await sync();
      throw error;
    }
    await sync();
  }
  async function save(
    input: WordInput,
    id?: string,
    expectedUpdatedAt?: string,
    signal?: AbortSignal,
  ) {
    const saved = await write(() => {
      signal?.throwIfAborted();
      if (repository === localWordRepository && id && !expectedUpdatedAt)
        throw new WordEditConflict();
      return repository.save(input, id, expectedUpdatedAt, signal);
    });
    if (expectedUpdatedAt && alive.current) {
      cache.current = cache.current.map((word) => (word.id === saved.id ? saved : word));
    }
    await sync();
    return saved;
  }
  async function addMany(inputs: WordInput[]) {
    const result = await write(() => repository.addMany(inputs));
    await sync();
    return result;
  }
  async function removeMany(ids: string[], beforeRemove?: () => void) {
    await write(() => {
      if (repository === localWordRepository) {
        const expected = new Map(words.map((word) => [word.id, word.updatedAt]));
        const current = new Map(
          localWordRepository.list().map((word) => [word.id, word.updatedAt]),
        );
        if (ids.some((id) => !expected.has(id) || expected.get(id) !== current.get(id)))
          throw new Error("Silinecek kelimeler değişti. Güncel listeyi kontrol edip yeniden dene.");
      }
      beforeRemove?.();
      return repository.removeMany(ids);
    });
    await sync();
  }
  async function applyScores(session: GameSession) {
    if (repository !== localWordRepository)
      throw new Error("Hesap sonucu sunucuda kaydedilmelidir.");
    await write(() => completeGuestResult(session, () => localWordRepository.list()));
    await sync();
  }
  return {
    words,
    verifyPlanWords,
    loading,
    loadError,
    reload: sync,
    recoverEmpty: canRecoverEmpty ? recoverEmpty : undefined,
    list: () => cache.current,
    save,
    edit,
    addMany,
    applyScores,
    remove: (id: string) => removeMany([id]),
    removeMany,
  };
}
