import type { WordEdit, WordEntry, WordInput } from "@yds-atlas/shared";
import { CirclePlus, ListFilter } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BulkWordDialog } from "@/features/word-library/components/bulk-word-dialog";
import { DailyPlanView } from "@/features/word-library/components/daily-plan-view";
import { LibraryStatus } from "@/features/word-library/components/library-status";
import { LibrarySummary } from "@/features/word-library/components/library-summary";
import {
  type LibraryView,
  LibraryViewTabs,
} from "@/features/word-library/components/library-view-tabs";
import { LocalFixtureControls } from "@/features/word-library/components/local-fixture-controls";
import { WordFormDialog } from "@/features/word-library/components/word-form-dialog";
import { useDailyPlan } from "@/features/word-library/hooks/use-daily-plan";
import { useWordLibraryView } from "@/features/word-library/hooks/use-word-library-view";
import { useWordSelection } from "@/features/word-library/hooks/use-word-selection";
import type { DailyGroup } from "@/features/word-library/model/daily-groups";
import type { WordAddMode } from "@/features/word-library/model/manual-word-import";
import type { WordFillProgress } from "@/features/word-library/model/prepare-word-inputs";
import type { GroupFilter } from "@/features/word-library/model/word-library-view";
import type { Notify } from "@/shared/lib/notify";
import { localFixtureProfile } from "@/shared/lib/storage-scope";
import { Button } from "@/shared/ui/button";
import { useAccountPlan } from "../hooks/use-account-plan";
import { useLibraryMaintenance } from "../hooks/use-library-maintenance";
import { useLibraryMutations } from "../hooks/use-library-mutations";
import { useLibraryGuide } from "./library-guide";
import { LibraryMaintenance } from "./library-maintenance";
import { LibraryPlanReconciliation, PendingPlanCommand } from "./library-plan-reconciliation";
import { LibraryWords } from "./library-words";

export interface WordLibraryPageProps {
  initialGroup?: GroupFilter;
  initialCreate?: boolean;
  words: WordEntry[];
  loading: boolean;
  verifyPlanWords: (words: WordEntry[]) => boolean;
  loadError: string;
  automaticLegacyRepair?: boolean;
  studyBlocked?: boolean;
  cloudPlanEnabled?: boolean;
  accountId?: string | null;
  onReload: () => void;
  onRecoverEmpty?: () => Promise<void>;
  onSave: (
    input: WordInput,
    onProgress?: (progress: WordFillProgress) => void,
    mode?: WordAddMode,
  ) => Promise<void>;
  onSaveProtected: (
    input: WordInput,
    id: string,
    expectedUpdatedAt: string,
    signal?: AbortSignal,
  ) => Promise<WordEntry>;
  onEdit: (patch: WordEdit, id: string, expectedUpdatedAt: string) => Promise<void>;
  listStudyWords: () => WordEntry[];
  onAddMany: (
    words: WordInput[],
    onProgress?: (progress: WordFillProgress) => void,
    mode?: WordAddMode,
    persist?: (prepared: WordInput[]) => Promise<{ added: number; duplicates: number }>,
  ) => Promise<{ added: number; duplicates: number }>;
  onRemove: (id: string) => Promise<void>;
  onRemoveMany: (ids: string[], beforeRemove?: () => void) => Promise<void>;
  onStudyGroup: (group: DailyGroup) => void;
  onNotify: Notify;
  onInitialCreateHandled?: () => void;
}

export function WordLibraryPage({
  initialGroup = "all",
  initialCreate = false,
  words,
  loading,
  verifyPlanWords,
  loadError,
  automaticLegacyRepair = false,
  studyBlocked = false,
  accountId = null,
  cloudPlanEnabled = false,
  onReload,
  onRecoverEmpty,
  onSave,
  onSaveProtected,
  onEdit,
  listStudyWords,
  onAddMany,
  onRemove,
  onRemoveMany,
  onStudyGroup,
  onNotify,
  onInitialCreateHandled,
}: WordLibraryPageProps) {
  const { t } = useTranslation();
  const view = useWordLibraryView(words, initialGroup);
  const local = useDailyPlan(words, verifyPlanWords, !cloudPlanEnabled && !loading && !loadError);
  const cloud = useAccountPlan(
    cloudPlanEnabled ? accountId : null,
    words,
    verifyPlanWords,
    !loading && !loadError,
  );
  const daily = cloudPlanEnabled ? cloud : local;
  const selection = useWordSelection();
  const [activeView, setActiveView] = useState<LibraryView>(() =>
    sessionStorage.getItem("atlas:daily-plan-help") === "1" ? "plan" : "words",
  );
  const maintenance = useLibraryMaintenance({ words, automaticLegacyRepair, accountId, onNotify });
  const libraryGuide = useLibraryGuide({ activeView });
  const {
    formOpen,
    bulkOpen,
    setBulkOpen,
    bulkTargetDay,
    setBulkTargetDay,
    editingWord,
    createTargetDay,
    bulkAddForDay,
    openGeneralBulk,
    bulkAssignWordIds,
    addManyToTargetDay,
    saveWord,
    editWord,
    addWordToDay,
    assignWord,
    removeWordFromDay,
    clearPlanDay,
    getDayRemoval,
    deleteDayWords,
    openCreate,
    changeFormOpen,
    deleteWord,
    deleteSelection,
    deleteAll,
  } = useLibraryMutations({
    initialCreate,
    words,
    accountId,
    cloudPlanEnabled,
    selection,
    daily,
    local,
    cloud,
    listStudyWords,
    onReload,
    onAddMany,
    onSave,
    onRemoveMany,
    onRemove,
    onNotify,
    onInitialCreateHandled,
  });
  if (cloudPlanEnabled && cloud.pending && !loading && !loadError && !cloud.loading)
    return (
      <PendingPlanCommand
        cloud={cloud}
        onConfirmed={() => {
          if (bulkTargetDay !== null) {
            setBulkOpen(false);
            setBulkTargetDay(null);
          }
          if (createTargetDay !== null) changeFormOpen(false);
          onReload();
        }}
      />
    );
  if (loading || loadError || daily.error || cloud.loading)
    return (
      <LibraryStatus
        loading={loading || cloud.loading}
        loadError={loadError || daily.error}
        onReload={() => {
          cloud.refresh();
          onReload();
        }}
        onRecoverEmpty={onRecoverEmpty}
      />
    );

  return (
    <>
      <div
        id="library-page-header"
        className="mb-5 flex items-end justify-between gap-6 max-sm:flex-col max-sm:items-stretch"
      >
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

      {import.meta.env.DEV && localFixtureProfile && !accountId && !loading && !loadError && (
        <LocalFixtureControls
          onChange={() => {
            onReload();
            setActiveView("plan");
          }}
        />
      )}
      <div id="library-view-tabs" className="mt-5">
        <LibraryViewTabs
          value={activeView}
          wordCount={words.length}
          activeDays={daily.plan.activeDays}
          onChange={setActiveView}
        />
      </div>

      {cloudPlanEnabled && cloud.choice && (
        <LibraryPlanReconciliation cloud={cloud} words={words} />
      )}
      {activeView === "plan" ? (
        <DailyPlanView
          key={accountId}
          plan={daily.plan}
          groupSize={daily.groupSize}
          words={words}
          error={daily.error}
          onGroupSizeChange={daily.setGroupSize}
          onStudyGroup={onStudyGroup}
          onSaveStudyWord={onSaveProtected}
          listStudyWords={listStudyWords}
          studyBlocked={studyBlocked}
          accountId={accountId}
          onAddWord={openCreate}
          onBulkAdd={openGeneralBulk}
          onBulkAddForDay={bulkAddForDay}
          onBulkAssignWordIds={bulkAssignWordIds}
          onCreateForDay={addWordToDay}
          onAssignWord={assignWord}
          onRemoveFromDay={removeWordFromDay}
          onClearDay={clearPlanDay}
          getDayRemoval={getDayRemoval}
          onDeleteDayWords={deleteDayWords}
          onEditWord={editWord}
          onDeleteWord={(word) => void deleteWord(word)}
        />
      ) : (
        <>
          <div id="library-word-controls" className="mt-4">
            <LibrarySummary counts={view.counts} onDeleteAll={() => void deleteAll()} />
            <LibraryMaintenance
              maintenance={maintenance}
              words={words}
              loading={loading}
              loadError={loadError}
              automaticLegacyRepair={automaticLegacyRepair}
              accountId={accountId}
              onSaveProtected={onSaveProtected}
              onNotify={onNotify}
            />
          </div>

          <LibraryWords
            view={view}
            selection={selection}
            hasWords={words.length > 0}
            openCreate={openCreate}
            openGeneralBulk={openGeneralBulk}
            editWord={editWord}
            deleteWord={deleteWord}
            deleteSelection={deleteSelection}
          />
        </>
      )}
      {libraryGuide}
      {formOpen && (
        <WordFormDialog
          key={editingWord?.id ?? "new-word"}
          canUseAi={Boolean(accountId)}
          open
          word={editingWord}
          onOpenChange={changeFormOpen}
          onSave={saveWord}
          onEdit={onEdit}
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
          canUseAi={Boolean(accountId)}
          onNotify={onNotify}
        />
      )}
    </>
  );
}
