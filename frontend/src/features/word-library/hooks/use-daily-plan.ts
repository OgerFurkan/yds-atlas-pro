import type { WordEntry } from "@yds-atlas/shared";
import { useMemo, useState } from "react";
import {
  buildDailyPlan,
  clampDailyGroupSize,
  DEFAULT_DAILY_GROUP_SIZE,
} from "../model/daily-groups";

export function useDailyPlan(words: WordEntry[], initialSize = DEFAULT_DAILY_GROUP_SIZE) {
  const [groupSize, setGroupSize] = useState(() => clampDailyGroupSize(initialSize));
  const plan = useMemo(() => buildDailyPlan(words, groupSize), [words, groupSize]);

  return {
    plan,
    groupSize,
    setGroupSize: (size: number) => setGroupSize(clampDailyGroupSize(size)),
  };
}
