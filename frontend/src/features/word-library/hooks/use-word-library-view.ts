import type { CefrLevel, WordEntry } from "@yds-atlas/shared";
import { useMemo, useState } from "react";
import {
  filterWords,
  type GroupFilter,
  type SortMode,
  wordCounts,
} from "../model/word-library-view";

export function useWordLibraryView(words: WordEntry[], initialGroup: GroupFilter = "all") {
  const [group, setGroup] = useState<GroupFilter>(initialGroup);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState<CefrLevel | "all">("all");
  const [sort, setSort] = useState<SortMode>("recent");

  const counts = useMemo(() => wordCounts(words), [words]);
  const filteredWords = useMemo(
    () => filterWords(words, { group, level, search, sort }),
    [words, group, level, search, sort],
  );

  function resetFilters() {
    setSearch("");
    setLevel("all");
    setGroup("all");
  }

  return {
    group,
    setGroup,
    search,
    setSearch,
    level,
    setLevel,
    sort,
    setSort,
    counts,
    filteredWords,
    resetFilters,
  };
}
