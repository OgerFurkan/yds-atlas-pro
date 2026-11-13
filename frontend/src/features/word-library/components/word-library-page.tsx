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
import { wordKey } from "@/features/word-library/model/word-normalization";
import type { GroupFilter } from "@/features/word-library/model/word-library-view";
import type { Notify } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";
import { GuidedTour, type GuideStep } from "@/shared/ui/guided-tour";

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
  const [libraryGuide, setLibraryGuide] = useState<number | null>(null);
  useEffect(() => {
    const onHelp = () => {
      if (activeView === "plan") window.dispatchEvent(new Event("atlas:daily-plan-help"));
      else setLibraryGuide(0);
    };
    window.addEventListener("atlas:help-request", onHelp);
    return () => window.removeEventListener("atlas:help-request", onHelp);
  }, [activeView]);
  useEffect(() => {
    if (sessionStorage.getItem("atlas:daily-plan-help") === "1") setActiveView("plan");
  }, []);
  const librarySteps: GuideStep[] = [
    { id: "library-overview", target: "#library-page-header", title: t("nav.libraryGuideIntro"), description: t("nav.libraryGuideIntroDescription") },
    { id: "library-tabs", target: "#library-view-tabs", title: t("nav.libraryGuideTabs"), description: t("nav.libraryGuideTabsDescription") },
    { id: "library-words", target: "#library-word-controls", title: t("nav.libraryGuideWords"), description: t("nav.libraryGuideWordsDescription") },
  ];
  const [formOpen, setFormOpen] = useState(initialCreate);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkTargetDay, setBulkTargetDay] = useState<number | null>(null);
  const pendingBulk = useRef<{ day: number; keys: Set<string> } | null>(null);
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

  // Words are persisted by the library API first. After its async refresh, match the
  // actual saved IDs and move all completed/duplicate imports into the requested day.
  // Never assign fabricated IDs or lose the partial Gemini successes.
  useEffect(() => {
    const pending = pendingBulk.current;
    if (!pending || !pending.keys.size) return;
    const found = words.filter((word) => pending.keys.has(wordKey(word.word)));
    if (!found.length) return;
    try {
      const result = daily.assignMany(found.map((word) => word.id), pending.day);
      for (const word of found) pending.keys.delete(wordKey(word.word));
      if (result.added || result.moved) {
        onNotify.success(`${found.length} kelime ${pending.day}. güne yerleştirildi.`);
      }
    } catch (reason) {
      // A full target day must never remove the imported words from the library.
      for (const word of found) pending.keys.delete(wordKey(word.word));
      onNotify.error(reason instanceof Error ? reason.message : "Toplu eklenen kelimeler güne atanamadı.");
    }
    if (pending.keys.size === 0) pendingBulk.current = null;
  }, [words, daily, onNotify]);

  function bulkAddForDay(day: number) {
    setBulkTargetDay(day);
    setBulkOpen(true);
  }

  function openGeneralBulk() {
    setBulkTargetDay(null);
    setBulkOpen(true);
  }

  function bulkAssignWordIds(wordIds: string[], day: number) {
    try {
      const result = daily.assignMany(wordIds, day);
      onNotify.success(`${result.added} kelime eklendi, ${result.moved} kelime taşındı.`);
      return true;
    } catch (reason) {
      onNotify.error(reason instanceof Error ? reason.message : "Kelimeler güne atanamadı.");
      return false;
    }
  }

  async function addManyToTargetDay(inputs: WordInput[], onProgress?: (progress: WordFillProgress) => void) {
    if (bulkTargetDay === null) return onAddMany(inputs, onProgress);
    const day = bulkTargetDay;
    const alreadyInDay = new Set(daily.plan.groups[day - 1]?.words.map((word) => wordKey(word.word)) ?? []);
    const requested = new Set(inputs.map((input) => wordKey(input.word)).filter((key) => !alreadyInDay.has(key)));
    const freeSlots = Math.max(0, 40 - (daily.plan.groups[day - 1]?.total ?? 0));
    if (requested.size > freeSlots) {
      throw new Error(`${day}. günde ${freeSlots} boş yer var. Lütfen listeyi küçült.`);
    }
    const requestedKeys = new Set(inputs.map((input) => wordKey(input.word)));
    const elsewhere = daily.plan.groups.filter((group) => group.day !== day)
      .flatMap((group) => group.words)
      .filter((word) => requestedKeys.has(wordKey(word.word)));
    if (elsewhere.length && !window.confirm(
      `${elsewhere.length} mevcut kelime diğer günlerden ${day}. güne taşınacak. Devam edilsin mi?`,
    )) throw new Error("Günler arası kelime taşıma iptal edildi.");
    if (pendingBulk.current && pendingBulk.current.day !== day && pendingBulk.current.keys.size)
      throw new Error("Önce önceki toplu ekleme işlemi tamamlansın.");
    const pending = pendingBulk.current ?? { day, keys: new Set<string>() };
    pendingBulk.current = pending;
    for (const key of requested) pending.keys.add(key);
    let failedWords = new Set<string>();
    try {
      const result = await onAddMany(inputs, (progress) => {
        failedWords = new Set((progress.failedWords ?? []).map(wordKey));
        onProgress?.(progress);
      });
      // Missing AI words are not saved. Retried words can be enqueued later.
      for (const key of failedWords) pending.keys.delete(key);
      if (!pending.keys.size) pendingBulk.current = null;
      return result;
    } catch (reason) {
      for (const key of requested) pending.keys.delete(key);
      if (!pending.keys.size) pendingBulk.current = null;
      throw reason;
    }
  }

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
      <div id="library-page-header" className="mb-5 flex items-end justify-between gap-6 max-sm:flex-col max-sm:items-stretch">
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
          <Button variant="secondary" type="button" onClick={openGeneralBulk}>
            <ListFilter size={16} /> {t("library.bulkAdd")}
          </Button>
          <Button type="button" onClick={openCreate}>
            <CirclePlus size={17} /> {t("library.add")}
          </Button>
        </div>
      </div>

      <div id="library-view-tabs" className="mt-5">
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
          onBulkAdd={openGeneralBulk}
          onBulkAddForDay={bulkAddForDay}
          onBulkAssignWordIds={bulkAssignWordIds}
          onCreateForDay={addWordToDay}
          onAssignWord={assignWord}
          onRemoveFromDay={removeWordFromDay}
          onEditWord={editWord}
          onDeleteWord={(word) => void deleteWord(word)}
        />
      ) : (
        <>
          <div id="library-word-controls" className="mt-4">
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
              <LibraryEmpty onAdd={openCreate} onBulk={openGeneralBulk} />
            )}
          </section>
        </>
      )}
      {libraryGuide !== null && activeView === "words" && (
        <GuidedTour
          step={librarySteps[libraryGuide]}
          index={libraryGuide}
          total={librarySteps.length}
          name={t("nav.libraryGuide")}
          onNext={() => setLibraryGuide((current) => current === null || current >= librarySteps.length - 1 ? null : current + 1)}
          onExit={() => setLibraryGuide(null)}
        />
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
        <BulkWordDialog
          open
          targetDay={bulkTargetDay ?? undefined}
          onOpenChange={(open) => {
            setBulkOpen(open);
            if (!open) setBulkTargetDay(null);
          }}
          onAddMany={addManyToTargetDay}
          onNotify={onNotify}
        />
      )}
    </>
  );
}
