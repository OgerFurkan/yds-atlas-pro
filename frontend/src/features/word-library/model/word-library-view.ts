import { type CefrLevel, getWordGroup, type WordEntry, type WordGroup } from "@yds-atlas/shared";

export type GroupFilter = WordGroup | "all";
export type SortMode = "recent" | "alphabetical" | "score";

export interface WordFilters {
  group: GroupFilter;
  level: CefrLevel | "all";
  search: string;
  sort: SortMode;
}

export type WordCounts = Record<GroupFilter, number>;

export function wordCounts(words: WordEntry[]): WordCounts {
  const counts: WordCounts = { all: words.length, hard: 0, review: 0, learned: 0 };
  for (const word of words) counts[getWordGroup(word.score)] += 1;
  return counts;
}

export function searchableText(word: WordEntry) {
  return [word.word, ...word.alternatives, ...word.meanings].join(" ").toLocaleLowerCase("en");
}

export function filterWords(words: WordEntry[], filters: WordFilters) {
  const query = filters.search.trim().toLocaleLowerCase("en");
  return words
    .filter((word) => {
      const matchesGroup = filters.group === "all" || getWordGroup(word.score) === filters.group;
      const matchesLevel = filters.level === "all" || word.cefr === filters.level;
      return matchesGroup && matchesLevel && searchableText(word).includes(query);
    })
    .sort((first, second) => {
      if (filters.sort === "alphabetical") return first.word.localeCompare(second.word);
      if (filters.sort === "score") return second.score - first.score;
      return second.updatedAt.localeCompare(first.updatedAt);
    });
}

export function toggleSelection(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter((selected) => selected !== id) : [...ids, id];
}

export function toggleVisibleSelection(ids: string[], visibleIds: string[]) {
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => ids.includes(id));
  return allSelected
    ? ids.filter((id) => !visibleIds.includes(id))
    : [...new Set([...ids, ...visibleIds])];
}
