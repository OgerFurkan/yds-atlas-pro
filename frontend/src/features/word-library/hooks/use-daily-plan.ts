import type { WordEntry, WordInput } from "@yds-atlas/shared";
import { useEffect, useMemo, useState } from "react";
import { writeStorage } from "@/shared/lib/storage";
import { storageKeys } from "@/shared/lib/storage-keys";
import { getStorageScope } from "@/shared/lib/storage-scope";
import {
  type DailyWordGroup,
  DailyWordGroupsRepository,
} from "../api/daily-word-groups-repository";
import {
  initializeEmptyLibrary,
  localWordRepository,
  withLocalWordWrite,
} from "../api/local-word-repository";
import {
  buildDailyPlan,
  clampDailyGroupSize,
  DEFAULT_DAILY_GROUP_SIZE,
  dailyPlanWordIds,
} from "../model/daily-groups";

import { wordKey } from "../model/word-normalization";

export function useDailyPlan(
  words: WordEntry[],
  verifyWords: (snapshot: WordEntry[]) => boolean,
  enabled: boolean,
) {
  const repository = useMemo(() => new DailyWordGroupsRepository(), []);
  const [groupSize, setSize] = useState(DEFAULT_DAILY_GROUP_SIZE);
  const [groups, setGroups] = useState<DailyWordGroup[]>([]);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    queueMicrotask(async () => {
      function synchronize(persist: boolean) {
        if (!current || !verifyWords(words)) return;
        const synced = repository.syncWords(
          dailyPlanWordIds(words),
          undefined,
          persist,
          getStorageScope() !== null,
        );
        return { ...synced, revision: JSON.stringify(repository.readPlan()) };
      }
      try {
        const synced =
          typeof navigator.locks?.request === "function"
            ? await withLocalWordWrite(() => synchronize(true))
            : synchronize(false);
        if (current && synced) {
          setRevision(synced.revision);
          setSize(synced.size);
          setGroups(synced.groups);
          setError("");
        }
      } catch (reason) {
        if (current)
          setError(reason instanceof Error ? reason.message : "Günlük plan kaydedilemedi.");
      }
    });
    return () => {
      current = false;
    };
  }, [enabled, words, repository, verifyWords]);

  const plan = useMemo(() => buildDailyPlan(words, groupSize, groups), [words, groupSize, groups]);

  async function change<T>(perform: () => T, expectedRevision = revision) {
    try {
      const { result, stored } = await withLocalWordWrite(() => {
        if (!verifyWords(words)) throw new Error("Kelime listesi değişti. Yeniden dene.");
        if (expectedRevision !== JSON.stringify(repository.readPlan()))
          throw new Error("Günlük plan başka bir işlemde değişti. Yeniden yükleyip dene.");
        const result = perform();
        return { result, stored: repository.readPlan() };
      });
      setRevision(JSON.stringify(stored));
      setGroups(stored.groups);
      setSize(stored.size);
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Günlük plan okunamadı.");
      throw reason;
    }
  }

  async function setGroupSize(size: number) {
    try {
      await change(() => {
        // Persist a verified empty guest library before creating its first plan setting.
        if (!words.length && getStorageScope() === null) initializeEmptyLibrary();
        const next = clampDailyGroupSize(size);
        writeStorage(storageKeys.dailyPlanGroupSize, next);
        repository.syncWords(dailyPlanWordIds(words), undefined, true, getStorageScope() !== null);
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Grup boyutu kaydedilemedi.");
    }
  }

  function assign(wordId: string, day: number) {
    return change(() => {
      const existing = repository.getGroups().find((group) => group.words.includes(wordId));
      if (existing && existing.day !== day) repository.moveWordToDay(wordId, existing.day, day);
      else repository.assignWordToDay(wordId, day);
      const success = repository
        .getGroups()
        .some((group) => group.day === day && group.words.includes(wordId));
      return success;
    });
  }

  function addGuestToDay(inputs: WordInput[], day: number, single = false) {
    return change(() => {
      if (getStorageScope() !== null) throw new Error("Misafir profili değişti.");
      const result = single ? { added: 1, duplicates: 0 } : localWordRepository.addMany(inputs);
      if (single) localWordRepository.save(inputs[0]);
      const keys = new Set(inputs.map((input) => wordKey(input.word)));
      const ids = localWordRepository
        .list()
        .filter((word) => keys.has(wordKey(word.word)))
        .map((word) => word.id);
      repository.assignManyToDay(ids, day);
      return result;
    });
  }
  function assignMany(wordIds: string[], day: number) {
    return change(() => repository.assignManyToDay(wordIds, day));
  }

  function removeFromDay(wordId: string, day: number) {
    return change(() => repository.excludeWordFromDay(wordId, day));
  }

  function clearDay(day: number, expectedRevision: string) {
    return change(() => {
      return repository.clearDay(day);
    }, expectedRevision);
  }

  return {
    plan,
    groupSize,
    error,
    setGroupSize,
    assign,
    assignMany,
    addGuestToDay,
    removeFromDay,
    clearDay,
    getDayRemoval: (day: number) => {
      try {
        if (!verifyWords(words)) throw new Error("Kelime listesi değişti. Yeniden dene.");
        const stored = repository.readPlan();
        return {
          ...repository.getDayRemoval(day, stored.groups),
          planRevision: JSON.stringify(stored),
        };
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Günlük plan okunamadı.");
        return null;
      }
    },
  };
}
