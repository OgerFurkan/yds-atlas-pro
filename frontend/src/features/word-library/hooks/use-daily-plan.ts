import type { WordEntry } from "@yds-atlas/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { readStorage, writeStorage } from "@/shared/lib/storage";
import { storageKeys } from "@/shared/lib/storage-keys";
import { DailyWordGroupsRepository } from "../api/daily-word-groups-repository";
import {
  buildDailyPlan,
  clampDailyGroupSize,
  DEFAULT_DAILY_GROUP_SIZE,
} from "../model/daily-groups";

export function useDailyPlan(
  words: WordEntry[],
  initialSize = DEFAULT_DAILY_GROUP_SIZE,
  enabled = true,
) {
  const repository = useMemo(() => new DailyWordGroupsRepository(), []);
  const [groupSize, setSize] = useState(() =>
    clampDailyGroupSize(readStorage<number>(storageKeys.dailyPlanGroupSize, initialSize)),
  );
  const [groups, setGroups] = useState(() => repository.getGroups());
  const [error, setError] = useState("");
  const refresh = useCallback(() => setGroups(repository.getGroups()), [repository]);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      try {
        repository.syncWords(
          [...words]
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
            .map((word) => word.id),
          groupSize,
        );
        setError("");
        refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Günlük plan kaydedilemedi.");
      }
    });
    return () => {
      current = false;
    };
  }, [enabled, words, groupSize, repository, refresh]);

  const plan = useMemo(() => buildDailyPlan(words, groupSize, groups), [words, groupSize, groups]);

  function setGroupSize(size: number) {
    const next = clampDailyGroupSize(size);
    writeStorage(storageKeys.dailyPlanGroupSize, next);
    setSize(next);
  }

  function assign(wordId: string, day: number) {
    const existing = repository.getGroups().find((group) => group.words.includes(wordId));
    if (existing && existing.day !== day) repository.moveWordToDay(wordId, existing.day, day);
    else repository.assignWordToDay(wordId, day);
    const success = repository
      .getGroups()
      .some((group) => group.day === day && group.words.includes(wordId));
    refresh();
    return success;
  }

  function assignMany(wordIds: string[], day: number) {
    const result = repository.assignManyToDay(wordIds, day);
    if (result.added || result.moved) refresh();
    return result;
  }

  function removeFromDay(wordId: string, day: number) {
    repository.excludeWordFromDay(wordId, day);
    refresh();
  }

  function clearDay(day: number) {
    const removed = repository.clearDay(day);
    if (removed) refresh();
    return removed;
  }

  return {
    plan,
    groupSize,
    error,
    setGroupSize,
    assign,
    assignMany,
    removeFromDay,
    clearDay,
    getDayRemoval: (day: number) => repository.getDayRemoval(day),
    refresh,
  };
}
