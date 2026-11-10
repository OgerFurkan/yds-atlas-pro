import { useState } from "react";
import { toggleSelection, toggleVisibleSelection } from "../model/word-library-view";

export function useWordSelection() {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  function toggleWord(id: string) {
    setSelectedIds((current) => toggleSelection(current, id));
  }

  function toggleVisibleWords(visibleIds: string[]) {
    setSelectedIds((current) => toggleVisibleSelection(current, visibleIds));
  }

  function remove(id: string) {
    setSelectedIds((current) => current.filter((selected) => selected !== id));
  }

  function clear() {
    setSelectedIds([]);
  }

  return { selectedIds, toggleWord, toggleVisibleWords, remove, clear };
}
