import type { WordEdit, WordEntry, WordInput } from "@yds-atlas/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { getStorageScope } from "@/shared/lib/storage-scope";
import { localWordRepository, withLocalWordWrite } from "../api/local-word-repository";
import { WordEditConflict, type WordRepository } from "../api/word-repository";
export function useWordLibrary(repository: WordRepository = localWordRepository) {
  const [words, setWords] = useState<WordEntry[]>(() => {
    try {
      return repository === localWordRepository ? localWordRepository.list() : [];
    } catch {
      return [];
    }
  });
  const cache = useRef(words);
  const [loading, setLoading] = useState(repository !== localWordRepository);
  const [loadError, setLoadError] = useState("");
  const generation = useRef(0);
  const alive = useRef(true);
  const sync = useCallback(async () => {
    const current = ++generation.current;
    try {
      const entries = await repository.list();
      if (!alive.current || current !== generation.current) return;
      cache.current = entries;
      setWords(entries);
      setLoadError("");
      setLoading(false);
    } catch (error) {
      if (alive.current && current === generation.current) {
        setLoadError(error instanceof Error ? error.message : "Kelimeler yüklenemedi.");
        setLoading(false);
      }
    }
  }, [repository]);
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
  function write<T>(perform: () => T, requireLock = false) {
    if (repository !== localWordRepository) return perform();
    if (getStorageScope() !== null) throw new Error("Hesap değişti. İşlemi yeniden başlat.");
    return withLocalWordWrite(perform, requireLock);
  }
  async function edit(patch: WordEdit, id: string, expectedUpdatedAt: string) {
    try {
      await write(() => repository.edit(patch, id, expectedUpdatedAt), true);
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
      return repository.save(input, id, expectedUpdatedAt, signal);
    }, id !== undefined);
    if (expectedUpdatedAt && alive.current) {
      cache.current = cache.current.map((word) => (word.id === saved.id ? saved : word));
      setWords(cache.current);
    }
    await sync();
    return saved;
  }
  async function addMany(inputs: WordInput[]) {
    const result = await write(() => repository.addMany(inputs));
    await sync();
    return result;
  }
  async function removeMany(ids: string[]) {
    await write(() => repository.removeMany(ids));
    await sync();
  }
  async function applyScores(updates: { id: string; score: number }[]) {
    await write(() => repository.applyScores(updates));
    await sync();
  }
  return {
    words,
    loading,
    loadError,
    reload: sync,
    list: () => cache.current,
    save,
    edit,
    addMany,
    applyScores,
    remove: (id: string) => removeMany([id]),
    removeMany,
  };
}
