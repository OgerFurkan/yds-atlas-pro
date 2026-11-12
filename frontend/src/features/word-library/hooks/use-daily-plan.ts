import type { WordEntry } from "@yds-atlas/shared";
import { useEffect, useMemo, useState } from "react";
import { DailyWordGroupsRepository } from "../api/daily-word-groups-repository";
import {
  buildDailyPlan,
  clampDailyGroupSize,
  DEFAULT_DAILY_GROUP_SIZE,
} from "../model/daily-groups";
import { readStorage, writeStorage } from "@/shared/lib/storage";
import { storageKeys } from "@/shared/lib/storage-keys";

export function useDailyPlan(
  words: WordEntry[],
  initialSize = DEFAULT_DAILY_GROUP_SIZE,
  enabled = true,
) {
  const repository = useMemo(() => new DailyWordGroupsRepository(), []);
  const [groupSize, setSize] = useState(() =>
    clampDailyGroupSize(readStorage<number>(storageKeys.dailyPlanGroupSize, initialSize)),
  );
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const refresh = () => setRevision((previous) => previous + 1);

  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled, words, groupSize, repository]);

  const plan = useMemo(
    () => buildDailyPlan(words, groupSize, repository.getGroups()),
    [words, groupSize, revision, repository],
  );

  function setGroupSize(size: number) {
    const next = clampDailyGroupSize(size);
    writeStorage(storageKeys.dailyPlanGroupSize, next);
    setSize(next);
  }

  function assign(wordId: string, day: number) {
    const existing = repository.getGroups().find((group) => group.words.includes(wordId));
    if (existing && existing.day !== day) repository.moveWordToDay(wordId, existing.day, day);
    else repository.assignWordToDay(wordId, day);
    const success = repository.getGroups().some(
      (group) => group.day === day && group.words.includes(wordId),
    );
    refresh();
    return success;
  }

  function removeFromDay(wordId: string, day: number) {
    repository.excludeWordFromDay(wordId, day);
    refresh();
  }

  return { plan, groupSize, error, setGroupSize, assign, removeFromDay, refresh };
}
