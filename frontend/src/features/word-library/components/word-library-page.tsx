import type { WordEntry, WordInput } from "@yds-atlas/shared";
import { CirclePlus, ListFilter } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  const daily = useDailyPlan(words, 20, !loading && !loadError);
  const selection = useWordSelection();
  const [activeView, setActiveView] = useState<LibraryView>("words");
  const [formOpen, setFormOpen] = useState(initialCreate);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editingWord, setEditingWord] = useState<WordEntry>();
  const [createTargetDay, setCreateTargetDay] = useState<number | null>(null);
  const pendingCreate = useRef<{
    day: number;
    label: string;
    previousIds: Set<string>;
  } | null>(null);

  useEffect(() => {
    const pending = pendingCreate.current;
    if (!pending) return;
    const created = words.find(
      (word) => !pending.previousIds.has(word.id) &&
        word.word.trim().toLocaleLowerCase("en") === pending.label,
    );
    if (!created) return;
    pendingCreate.current = null;
    try {
      if (daily.assign(created.id, pending.day))
        onNotify.success(`Kelime ${pending.day}. güne eklendi.`);
      else
        onNotify.error("Kelime kütüphaneye kaydedildi ancak seçilen gün dolu; başka bir güne ekleyebilirsin.");
    } catch (reason) {
      onNotify.error(reason instanceof Error ? reason.message : "Kelime güne atanamadı.");
    }
  }, [words, daily, onNotify]);

  async function saveWord(input: WordInput, id?: string, onProgress?: (progress: WordFillProgress) => void) {
    if (!id && createTargetDay !== null) {
      pendingCreate.current = {
        day: createTargetDay,
        label: input.word.trim().toLocaleLowerCase("en"),
        previousIds: new Set(words.map((word) => word.id)),
      };
    }
    try {
      await onSave(input, id, onProgress);
    } catch (reason) {
      pendingCreate.current = null;
      throw reason;
    }
  }

  function editWord(word: WordEntry) {
    setCreateTargetDay(null);
    setEditingWord(word);
    setFormOpen(true);
  }

  function addWordToDay(day: number) {
    setCreateTargetDay(day);
    setEditingWord(undefined);
    setFormOpen(true);
  }

  function assignWord(wordId: string, day: number) {
    try {
      const group = daily.plan.groups[day - 1];
      if (!group || (group.total >= 40 && !group.words.some((word) => word.id === wordId))) {
        onNotify.error("Bir güne en fazla 40 kelime eklenebilir.");
        return;
      }
      if (daily.assign(wordId, day)) onNotify.success(`${day}. gün güncellendi.`);
      else onNotify.error("Kelime bu güne atanamadı. Günün kapasitesini kontrol et.");
    } catch (reason) {
      onNotify.error(reason instanceof Error ? reason.message : "Kelime güne atanamadı.");
    }
  }

  function removeWordFromDay(wordId: string, day: number) {
    try {
      daily.removeFromDay(wordId, day);
      onNotify.success("Kelime plandan çıkarıldı; kütüphanede duruyor.");
    } catch (reason) {
      onNotify.error(reason instanceof Error ? reason.message : "Kelime plandan çıkarılamadı.");
    }
  }

  function openCreate() {
    setCreateTargetDay(null);
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
          words={words}
          error={daily.error}
          onGroupSizeChange={daily.setGroupSize}
          onStudyGroup={onStudyGroup}
          onAddWord={openCreate}
          onBulkAdd={() => setBulkOpen(true)}
          onCreateForDay={addWordToDay}
          onAssignWord={assignWord}
          onRemoveFromDay={removeWordFromDay}
          onEditWord={editWord}
          onDeleteWord={(word) => void deleteWord(word)}
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
                onEdit={editWord}
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
          onSave={saveWord}
          onNotify={onNotify}
        />
      )}
      {bulkOpen && (
        <BulkWordDialog open onOpenChange={setBulkOpen} onAddMany={onAddMany} onNotify={onNotify} />
      )}
    </>
  );
}
