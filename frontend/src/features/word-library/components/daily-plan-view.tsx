import { getWordGroup, type WordEntry, type WordInput } from "@yds-atlas/shared";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LibraryEmpty } from "@/features/word-library/components/library-status";
import {
  type DailyGroup,
  type DailyPlan,
  isDayStudyReady,
  reviewableWords,
} from "@/features/word-library/model/daily-groups";
import { checkAiHealth } from "@/shared/hooks/use-ai-health";
import { Button } from "@/shared/ui/button";
import { GuidedTour } from "@/shared/ui/guided-tour";
import { useDailyPlanGuide } from "../hooks/use-daily-plan-guide";
import { useDayStudy } from "../hooks/use-day-study";
import { DailyGroupCard } from "./daily-group-card";
import { DailyPlanDayDialog } from "./daily-plan-day-dialog";
import { DailyPlanHero } from "./daily-plan-hero";
import { type DayRemoval, DayRemovalDialog } from "./day-removal-dialog";
import { DayReviewPanel } from "./day-review-panel";
import { DayStudyFeedback } from "./day-study-feedback";

export function DailyPlanView({
  plan,
  groupSize,
  words,
  error,
  onGroupSizeChange,
  onStudyGroup,
  onSaveStudyWord,
  listStudyWords,
  studyBlocked,
  accountId = null,
  onAddWord,
  onBulkAdd,
  onBulkAddForDay,
  onBulkAssignWordIds,
  onCreateForDay,
  onAssignWord,
  onRemoveFromDay,
  onClearDay,
  getDayRemoval,
  onDeleteDayWords,
  onEditWord,
  onDeleteWord,
}: {
  plan: DailyPlan;
  groupSize: number;
  words: WordEntry[];
  error?: string;
  onGroupSizeChange: (size: number) => void;
  onStudyGroup: (group: DailyGroup) => void;
  onSaveStudyWord: (
    input: WordInput,
    id: string,
    expectedUpdatedAt: string,
    signal?: AbortSignal,
  ) => Promise<WordEntry>;
  listStudyWords: () => WordEntry[];
  studyBlocked: boolean;
  accountId?: string | null;
  onAddWord: () => void;
  onBulkAdd: () => void;
  onBulkAddForDay: (day: number) => void;
  onBulkAssignWordIds: (wordIds: string[], day: number) => Promise<boolean>;
  onCreateForDay: (day: number) => void;
  onAssignWord: (wordId: string, day: number) => void;
  onRemoveFromDay: (wordId: string, day: number) => void;
  onClearDay: (day: number, expectedRevision: string) => Promise<boolean>;
  getDayRemoval: (day: number) => DayRemoval | null;
  onDeleteDayWords: (day: number, expected: DayRemoval) => Promise<void>;
  onEditWord: (word: WordEntry) => void;
  onDeleteWord: (word: WordEntry) => void;
}) {
  const { t } = useTranslation();
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const detailStatusId = useId();
  const [clearDay, setClearDay] = useState<{ day: number; removal: DayRemoval } | null>(null);
  const detailTriggerDay = useRef<number | null>(null);
  const [review, setReview] = useState<{ day: number; owner: string | null } | null>(null);
  const { tourStep, setTourStep, tourSteps } = useDailyPlanGuide(() => setSelectedDay(null));
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");
  const [bulkPickerOpen, setBulkPickerOpen] = useState(false);
  const [aiNotice, setAiNotice] = useState<{ day: number; message: string } | null>(null);
  const nextEmpty = plan.groups.find((group) => group.total === 0);
  const compactGroups = plan.groups.filter(
    (group) => group.total > 0 || (nextEmpty && group.day === nextEmpty.day),
  );
  const visibleGroups = showAll ? plan.groups : compactGroups;
  const study = useDayStudy({
    plan,
    onStudyGroup,
    onSaveStudyWord,
    listStudyWords,
    studyBlocked,
    accountId,
  });
  const { preparation, preparing, stateFor, healthIssue, requestStudy, resetPreparation } = study;
  const recheck = () => void checkAiHealth();
  function editFirstIncomplete(group: DailyGroup) {
    const word = group.words.find(
      (entry) => getWordGroup(entry.score) !== "learned" && !isDayStudyReady(entry),
    );
    if (word) onEditWord(word);
  }
  function openDay(day: number) {
    if (preparing) return;
    if (preparation?.day !== day) resetPreparation();
    detailTriggerDay.current = day;
    setSelectedDay(day);
    setSearch("");
    setBulkPickerOpen(false);
  }

  const studyFeedback = preparation && (
    <DayStudyFeedback
      study={study}
      plan={plan}
      studyBlocked={studyBlocked}
      selectedDay={selectedDay}
      editFirstIncomplete={editFirstIncomplete}
      openDay={openDay}
      onStudyGroup={onStudyGroup}
    />
  );
  // Account switch never reuses a previous account's review words.
  if (review && review.owner === accountId) {
    const selected = plan.groups[review.day - 1];
    if (selected)
      return (
        <DayReviewPanel
          key={review.day}
          day={review.day}
          words={reviewableWords(selected)}
          onEditMissing={(word) => {
            setReview(null);
            onEditWord(word);
          }}
          onExit={() => setReview(null)}
        />
      );
  }

  return (
    <div className="mt-4 space-y-5">
      <DailyPlanHero
        plan={plan}
        groupSize={groupSize}
        onGroupSizeChange={onGroupSizeChange}
        onBulkAdd={onBulkAdd}
        onGuide={() => setTourStep(0)}
      />

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {plan.overflow > 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {t("library.daily.manage.overflow", { count: plan.overflow })}
        </p>
      )}

      {plan.totalWords === 0 && words.length === 0 && (
        <LibraryEmpty onAdd={onAddWord} onBulk={onBulkAdd} />
      )}

      <section id="daily-plan-groups" tabIndex={-1} aria-label={t("library.daily.gridAria")}>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              {t("library.daily.manage.groupsHeading")}
            </h3>
            <p className="text-xs text-muted-foreground">{t("library.daily.manage.groupsHint")}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowAll((current) => !current)}>
            {showAll ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            {showAll ? t("library.daily.manage.hideEmpty") : t("library.daily.manage.showAll")}
          </Button>
        </div>
        {selectedDay === null && studyFeedback}
        <div
          id="daily-plan-study-area"
          className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3"
        >
          {visibleGroups.map((group) => (
            <DailyGroupCard
              key={group.day}
              group={group}
              targetSize={groupSize}
              onOpen={openDay}
              onStudy={requestStudy}
              busy={preparing}
              studyState={stateFor(group)}
              healthIssue={healthIssue}
              canCompleteContent={Boolean(accountId) && !studyBlocked}
              onRecheck={recheck}
              onComplete={(group) => {
                if (studyBlocked || !accountId) {
                  setAiNotice({
                    day: group.day,
                    message:
                      "Eksikleri AI ile tamamlamak için hesabına giriş yapıp API bağlantısını doğrula. LOCAL sentetik test profili gerçek AI çağrısı yapmaz.",
                  });
                  return;
                }
                setAiNotice({
                  day: group.day,
                  message: "AI hazırlığı başlatılıyor. Kelimelerin bilgileri kontrol ediliyor…",
                });
                try {
                  void Promise.resolve(requestStudy(group, true, true))
                    .then(() => setAiNotice(null))
                    .catch(() =>
                      setAiNotice({
                        day: group.day,
                        message: "AI hazırlığı başlatılamadı. Bağlantıyı kontrol edip tekrar dene.",
                      }),
                    );
                } catch {
                  setAiNotice({
                    day: group.day,
                    message: "AI hazırlığı başlatılamadı. Bağlantıyı kontrol edip tekrar dene.",
                  });
                }
              }}
              preparationNotice={
                preparation?.day === group.day && preparation.issue
                  ? preparation.issue
                  : aiNotice?.day === group.day
                    ? aiNotice.message
                    : undefined
              }
              preparationProgress={
                preparing && preparation?.day === group.day
                  ? { ready: preparation.ready, total: preparation.total }
                  : undefined
              }
              onClear={(day) => {
                const removal = getDayRemoval(day);
                if (removal) setClearDay({ day, removal });
              }}
              onReview={(selected) => setReview({ day: selected.day, owner: accountId })}
            />
          ))}
        </div>
      </section>

      {tourStep !== null && (
        <GuidedTour
          step={tourSteps[tourStep]}
          index={tourStep}
          total={tourSteps.length}
          name={t("library.daily.manage.tourName")}
          onNext={() =>
            setTourStep((current) =>
              current === null || current >= tourSteps.length - 1 ? null : current + 1,
            )
          }
          onExit={() => setTourStep(null)}
        />
      )}
      {clearDay && (
        <DayRemovalDialog
          day={clearDay.day}
          removal={clearDay.removal}
          taskActive={studyBlocked}
          onClose={() => setClearDay(null)}
          onClear={async () => {
            if (!(await onClearDay(clearDay.day, clearDay.removal.planRevision))) return false;
            if (preparation?.day === clearDay.day) resetPreparation();
            return true;
          }}
          onDelete={async () => {
            await onDeleteDayWords(clearDay.day, clearDay.removal);
            if (preparation?.day === clearDay.day) resetPreparation();
          }}
          restoreFocus={() => {
            const target =
              document.getElementById(`daily-day-${clearDay.day}-remove`) ??
              document.getElementById(`daily-day-${clearDay.day}-open`) ??
              document.getElementById("daily-plan-groups");
            target?.focus();
          }}
        />
      )}
      <DailyPlanDayDialog
        selectedDay={selectedDay}
        search={search}
        setSearch={setSearch}
        bulkPickerOpen={bulkPickerOpen}
        setBulkPickerOpen={setBulkPickerOpen}
        plan={plan}
        words={words}
        triggerDay={detailTriggerDay}
        study={study}
        studyFeedback={studyFeedback}
        detailStatusId={detailStatusId}
        recheck={recheck}
        editFirstIncomplete={editFirstIncomplete}
        onClose={() => setSelectedDay(null)}
        onReview={(day) => {
          setSelectedDay(null);
          setReview({ day, owner: accountId });
        }}
        onCreateForDay={onCreateForDay}
        onBulkAddForDay={onBulkAddForDay}
        onBulkAssignWordIds={onBulkAssignWordIds}
        onAssignWord={onAssignWord}
        onRemoveFromDay={onRemoveFromDay}
        onEditWord={onEditWord}
        onDeleteWord={onDeleteWord}
      />
    </div>
  );
}
