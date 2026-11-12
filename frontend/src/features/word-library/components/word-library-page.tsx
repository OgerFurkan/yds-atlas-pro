import type { WordEntry, WordInput } from "@yds-atlas/shared";
import { CirclePlus, ListFilter } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BulkWordDialog } from "@/features/word-library/components/bulk-word-dialog";
import { DailyPlanView } from "@/features/word-library/components/daily-plan-view";
import { LibraryFilterTabs } from "@/features/word-library/components/library-filter-tabs";
import { LibrarySelectionBar } from "@/features/word-library/components/library-selection-bar";
import {
  LibraryEmpty,
  LibraryNoResults,
  LibraryStatus,
} from "@/features/word-library/components/library-status";
import { LibrarySummary } from "@/features/word-library/components/library-summary";
import { LibraryToolbar } from "@/features/word-library/components/library-toolbar";
import {
  LibraryViewTabs,
  type LibraryView,
} from "@/features/word-library/components/library-view-tabs";
import { WordFormDialog } from "@/features/word-library/components/word-form-dialog";
import { WordList } from "@/features/word-library/components/word-list";
import { useDailyPlan } from "@/features/word-library/hooks/use-daily-plan";
import { useWordLibraryView } from "@/features/word-library/hooks/use-word-library-view";
import { useWordSelection } from "@/features/word-library/hooks/use-word-selection";
import type { DailyGroup } from "@/features/word-library/model/daily-groups";
import type { WordFillProgress } from "@/features/word-library/model/prepare-word-inputs";
import type { GroupFilter } from "@/features/word-library/model/word-library-view";
import type { Notify } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";

interface WordLibraryPageProps {
  initialGroup?: GroupFilter;
  initialCreate?: boolean;
  words: WordEntry[];
  loading: boolean;
  loadError: string;
  onReload: () => void;
  onSave: (
    input: WordInput,
    id?: string,
    onProgress?: (progress: WordFillProgress) => void,
  ) => Promise<void>;
  onAddMany: (
    words: WordInput[],
    onProgress?: (progress: WordFillProgress) => void,
  ) => Promise<{ added: number; duplicates: number }>;
  onRemove: (id: string) => Promise<void>;
  onRemoveMany: (ids: string[]) => Promise<void>;
  onStudyGroup: (group: DailyGroup) => void;
  onNotify: Notify;
  onInitialCreateHandled?: () => void;
}

export function WordLibraryPage({
  initialGroup = "all",
  initialCreate = false,
  words,
  loading,
  loadError,
  onReload,
  onSave,
  onAddMany,
  onRemove,
  onRemoveMany,
  onStudyGroup,
  onNotify,
  onInitialCreateHandled,
}: WordLibraryPageProps) {
  const { t } = useTranslation();
  const view = useWordLibraryView(words, initialGroup);
  const daily = useDailyPlan(words);
  const selection = useWordSelection();
  const [activeView, setActiveView] = useState<LibraryView>("words");
  const [formOpen, setFormOpen] = useState(initialCreate);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editingWord, setEditingWord] = useState<WordEntry>();

  function openCreate() {
    setEditingWord(undefined);
    setFormOpen(true);
  }

  function changeFormOpen(open: boolean) {
    setFormOpen(open);
    if (!open && initialCreate) onInitialCreateHandled?.();
  }

  async function deleteWord(word: WordEntry) {
    if (!window.confirm(t("library.confirmDelete", { word: word.word }))) return;
    try {
      await onRemove(word.id);
      selection.remove(word.id);
      onNotify.success(t("library.deleted"));
    } catch (error) {
      onNotify.error(error instanceof Error ? error.message : t("library.deleteFailed"));
    }
  }

  async function deleteSelection() {
    if (
      !selection.selectedIds.length ||
      !window.confirm(t("library.confirmDeleteSelected", { count: selection.selectedIds.length }))
    )
      return;
    try {
      await onRemoveMany(selection.selectedIds);
      selection.clear();
      onNotify.success(t("library.selectedDeleted"));
    } catch (error) {
      onNotify.error(error instanceof Error ? error.message : t("library.selectedDeleteFailed"));
    }
  }

  async function deleteAll() {
    if (!words.length || !window.confirm(t("library.confirmDeleteAll"))) return;
    try {
      await onRemoveMany(words.map((word) => word.id));
      selection.clear();
      onNotify.success(t("library.allDeleted"));
    } catch (error) {
      onNotify.error(error instanceof Error ? error.message : t("library.allDeleteFailed"));
    }
  }

  return (
    <>
      <div className="mb-5 flex items-end justify-between gap-6 max-sm:flex-col max-sm:items-stretch">
        <div>
          <p className="text-xs text-slate-400">
            Atlas <span className="px-1.5">/</span>
            <strong className="font-semibold text-atlas-blue">{t("library.breadcrumb")}</strong>
          </p>
          <h1 className="mt-2 mb-1 text-[clamp(24px,2.4vw,34px)] leading-tight font-semibold text-atlas-ink">
            {t("library.title")}
          </h1>
          <p className="text-sm text-atlas-muted">{t("library.subtitle")}</p>
        </div>
        <div className="flex gap-2 max-sm:grid max-sm:grid-cols-[.9fr_1.1fr]">
          <Button variant="secondary" type="button" onClick={() => setBulkOpen(true)}>
            <ListFilter size={16} /> {t("library.bulkAdd")}
          </Button>
          <Button type="button" onClick={openCreate}>
            <CirclePlus size={17} /> {t("library.add")}
          </Button>
        </div>
      </div>

      <div className="mt-5">
        <LibraryViewTabs
          value={activeView}
          wordCount={words.length}
          activeDays={daily.plan.activeDays}
          onChange={setActiveView}
        />
      </div>

      {activeView === "plan" ? (
        <DailyPlanView
          plan={daily.plan}
          groupSize={daily.groupSize}
          onGroupSizeChange={daily.setGroupSize}
          onStudyGroup={onStudyGroup}
          onAddWord={openCreate}
          onBulkAdd={() => setBulkOpen(true)}
        />
      ) : (
        <>
          <div className="mt-4">
            <LibrarySummary counts={view.counts} onDeleteAll={() => void deleteAll()} />
          </div>

          <section
            className="mt-4 rounded-lg border border-slate-200 bg-white"
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

            {loading || loadError ? (
              <LibraryStatus loading={loading} loadError={loadError} onReload={onReload} />
            ) : view.filteredWords.length ? (
              <WordList
                words={view.filteredWords}
                selectedIds={selection.selectedIds}
                onToggle={selection.toggleWord}
                onToggleAll={() =>
                  selection.toggleVisibleWords(view.filteredWords.map((word) => word.id))
                }
                onEdit={(word) => {
                  setEditingWord(word);
                  setFormOpen(true);
                }}
                onDelete={(word) => void deleteWord(word)}
              />
            ) : words.length ? (
              <LibraryNoResults onReset={view.resetFilters} />
            ) : (
              <LibraryEmpty onAdd={openCreate} onBulk={() => setBulkOpen(true)} />
            )}
          </section>
        </>
      )}
      {formOpen && (
        <WordFormDialog
          key={editingWord?.id ?? "new-word"}
          open
          word={editingWord}
          onOpenChange={changeFormOpen}
          onSave={onSave}
          onNotify={onNotify}
        />
      )}
      {bulkOpen && (
        <BulkWordDialog open onOpenChange={setBulkOpen} onAddMany={onAddMany} onNotify={onNotify} />
      )}
    </>
  );
}
