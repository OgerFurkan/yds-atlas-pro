import type { WordEntry } from "@yds-atlas/shared";
import { useTranslation } from "react-i18next";
import type { useWordLibraryView } from "../hooks/use-word-library-view";
import type { useWordSelection } from "../hooks/use-word-selection";
import { LibraryFilterTabs } from "./library-filter-tabs";
import { LibrarySelectionBar } from "./library-selection-bar";
import { LibraryEmpty, LibraryNoResults } from "./library-status";
import { LibraryToolbar } from "./library-toolbar";
import { WordList } from "./word-list";

export function LibraryWords({
  view,
  selection,
  hasWords,
  openCreate,
  openGeneralBulk,
  editWord,
  deleteWord,
  deleteSelection,
}: {
  view: ReturnType<typeof useWordLibraryView>;
  selection: ReturnType<typeof useWordSelection>;
  hasWords: boolean;
  openCreate: () => void;
  openGeneralBulk: () => void;
  editWord: (word: WordEntry) => void;
  deleteWord: (word: WordEntry) => Promise<void>;
  deleteSelection: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <section
      className="mt-4 overflow-hidden rounded-xl border border-border bg-card shadow-[0_5px_20px_rgba(15,35,52,0.035)]"
      aria-label={t("library.aria")}
    >
      <LibraryFilterTabs group={view.group} counts={view.counts} onChange={view.setGroup} />
      <LibraryToolbar
        search={view.search}
        onSearchChange={view.setSearch}
        level={view.level}
        onLevelChange={view.setLevel}
        sort={view.sort}
        onSortChange={view.setSort}
      />
      <LibrarySelectionBar
        count={selection.selectedIds.length}
        onDelete={() => void deleteSelection()}
        onClear={selection.clear}
      />

      {view.filteredWords.length ? (
        <WordList
          words={view.filteredWords}
          selectedIds={selection.selectedIds}
          onToggle={selection.toggleWord}
          onToggleAll={() =>
            selection.toggleVisibleWords(view.filteredWords.map((word) => word.id))
          }
          onEdit={editWord}
          onDelete={(word) => void deleteWord(word)}
        />
      ) : hasWords ? (
        <LibraryNoResults onReset={view.resetFilters} />
      ) : (
        <LibraryEmpty onAdd={openCreate} onBulk={openGeneralBulk} />
      )}
    </section>
  );
}
