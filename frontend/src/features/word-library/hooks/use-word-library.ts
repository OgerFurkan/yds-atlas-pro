import type { WordEntry, WordInput } from "@yds-atlas/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { localWordRepository } from "../api/local-word-repository";
import type { WordRepository } from "../api/word-repository";
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
  async function save(input: WordInput, id?: string) {
    const saved = await repository.save(input, id);
    await sync();
    return saved;
  }
  async function addMany(inputs: WordInput[]) {
    const result = await repository.addMany(inputs);
    await sync();
    return result;
  }
  async function removeMany(ids: string[]) {
    await repository.removeMany(ids);
    await sync();
  }
  async function applyScores(updates: { id: string; score: number }[]) {
    await repository.applyScores(updates);
    await sync();
  }
  return {
    words,
    loading,
    loadError,
    reload: sync,
    list: () => cache.current,
    save,
    addMany,
    applyScores,
    remove: (id: string) => removeMany([id]),
    removeMany,
  };
}
