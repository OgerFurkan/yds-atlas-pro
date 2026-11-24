import { getWordGroup, type WordEntry, type WordInput } from "@yds-atlas/shared";
import {
  ArrowRightLeft,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Clock3,
  Layers3,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LibraryEmpty } from "@/features/word-library/components/library-status";
import {
  type DailyGroup,
  type DailyPlan,
  dailyGroupSizes,
  isDayStudyReady,
  reviewableWords,
} from "@/features/word-library/model/daily-groups";
import { checkAiHealth } from "@/shared/hooks/use-ai-health";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { GuidedTour, type GuideStep } from "@/shared/ui/guided-tour";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { useDayStudy } from "../hooks/use-day-study";
import { DailyGroupCard } from "./daily-group-card";
import { type DayRemoval, DayRemovalDialog } from "./day-removal-dialog";
import { DayReviewPanel } from "./day-review-panel";
import { DayStudyButton, DayStudyStatus } from "./day-study-action";

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
  onBulkAssignWordIds: (wordIds: string[], day: number) => boolean;
  onCreateForDay: (day: number) => void;
  onAssignWord: (wordId: string, day: number) => void;
  onRemoveFromDay: (wordId: string, day: number) => void;
  onClearDay: (day: number) => boolean;
  getDayRemoval: (day: number) => DayRemoval;
  onDeleteDayWords: (day: number, ids: readonly string[]) => Promise<void>;
  onEditWord: (word: WordEntry) => void;
  onDeleteWord: (word: WordEntry) => void;
}) {
  const { t, i18n } = useTranslation();
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const detailStatusId = useId();
  const [clearDay, setClearDay] = useState<{ day: number; removal: DayRemoval } | null>(null);
  const detailTriggerDay = useRef<number | null>(null);
  const [review, setReview] = useState<{ day: number; owner: string | null } | null>(null);
  const [tourStep, setTourStep] = useState<number | null>(null);
  useEffect(() => {
    const startGuide = () => {
      setSelectedDay(null);
      setTourStep(0);
    };
    window.addEventListener("atlas:daily-plan-help", startGuide);
    if (sessionStorage.getItem("atlas:daily-plan-help") === "1") {
      sessionStorage.removeItem("atlas:daily-plan-help");
      startGuide();
    }
    return () => window.removeEventListener("atlas:daily-plan-help", startGuide);
  }, []);
  const tourSteps: GuideStep[] = [
    {
      id: "overview",
      target: "#daily-plan-hero",
      title: t("library.daily.manage.tourOverviewTitle"),
      description: t("library.daily.manage.tourOverviewDescription"),
    },
    {
      id: "target",
      target: "#daily-plan-target-selector",
      title: t("library.daily.manage.tourTargetTitle"),
      description: t("library.daily.manage.tourTargetDescription"),
    },
    {
      id: "days",
      target: "#daily-plan-groups",
      title: t("library.daily.manage.tourDaysTitle"),
      description: t("library.daily.manage.tourDaysDescription"),
    },
    {
      id: "bulk",
      target: "#daily-plan-bulk-add",
      title: t("library.daily.manage.tourBulkTitle"),
      description: t("library.daily.manage.tourBulkDescription"),
    },
    {
      id: "study",
      target: "#daily-plan-study-area",
      title: t("library.daily.manage.tourStudyTitle"),
      description: t("library.daily.manage.tourStudyDescription"),
    },
  ];
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");
  const [aiNotice, setAiNotice] = useState<{ day: number; message: string } | null>(null);
  const [bulkPickerOpen, setBulkPickerOpen] = useState(false);
  const [bulkQuery, setBulkQuery] = useState("");
  const [bulkSelected, setBulkSelected] = useState<string[]>([]);
  const [bulkUnassignedOnly, setBulkUnassignedOnly] = useState(false);
  const selectedGroup = selectedDay === null ? undefined : plan.groups[selectedDay - 1];
  const percent = plan.totalWords ? Math.round((plan.learned / plan.totalWords) * 100) : 0;
  const nextEmpty = plan.groups.find((group) => group.total === 0);
  const compactGroups = plan.groups.filter(
    (group) => group.total > 0 || (nextEmpty && group.day === nextEmpty.day),
  );
  const visibleGroups = showAll ? plan.groups : compactGroups;
  const assignedDays = useMemo(() => {
    const result = new Map<string, number>();
    for (const group of plan.groups) for (const word of group.words) result.set(word.id, group.day);
    return result;
  }, [plan.groups]);
  const availableWords = useMemo(
    () =>
      words
        .filter((word) => assignedDays.get(word.id) !== selectedDay)
        .sort((a, b) => a.word.localeCompare(b.word)),
    [words, assignedDays, selectedDay],
  );
  const bulkCandidates = availableWords.filter(
    (word) =>
      (!bulkUnassignedOnly || !assignedDays.has(word.id)) &&
      `${word.word} ${word.meanings.join(" ")}`
        .toLocaleLowerCase("tr")
        .includes(bulkQuery.trim().toLocaleLowerCase("tr")),
  );
  const availableSlots = Math.max(0, 40 - (selectedGroup?.total ?? 0));
  const filteredWords =
    selectedGroup?.words.filter((word) =>
      `${word.word} ${word.meanings.join(" ")}`
        .toLocaleLowerCase("tr")
        .includes(search.trim().toLocaleLowerCase("tr")),
    ) ?? [];

  const {
    preparation,
    preparing,
    stateFor,
    healthIssue,
    cancelStudy,
    requestStudy,
    resetPreparation,
  } = useDayStudy({
    plan,
    onStudyGroup,
    onSaveStudyWord,
    listStudyWords,
    studyBlocked,
    accountId,
  });
  const detailState = selectedGroup ? stateFor(selectedGroup) : "empty";
  const recheck = () => void checkAiHealth();
  function editFirstIncomplete(group: DailyGroup) {
    const word = group.words.find(
      (entry) => getWordGroup(entry.score) !== "learned" && !isDayStudyReady(entry),
    );
    if (word) onEditWord(word);
  }
  const studyFeedback = preparation && (
    <div className="space-y-2 rounded-lg border border-border bg-muted p-3 text-sm text-foreground">
      <p role="status">{t(`library.daily.manage.prepare_${preparation.phase}`)}</p>
      <progress
        className="block w-full accent-atlas-orange"
        aria-label={t("library.daily.manage.preparationProgress")}
        max={Math.max(1, preparation.total)}
        value={preparation.ready}
      />
      <p>
        {t("library.daily.manage.preparedCount", {
          ready: preparation.ready,
          total: preparation.total,
        })}
      </p>
      {preparation.issue && <p role="alert">{preparation.issue}</p>}
      {preparing ? (
        <Button variant="outline" size="sm" onClick={cancelStudy}>
          {t("library.daily.manage.cancelPreparation")}
        </Button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={studyBlocked}
            onClick={() => void requestStudy(plan.groups[preparation.day - 1], true)}
          >
            {t("library.daily.manage.retryPreparation")}
          </Button>
          {plan.groups[preparation.day - 1]?.playable > 0 && (
            <Button size="sm" onClick={() => onStudyGroup(plan.groups[preparation.day - 1])}>
              {t("library.daily.manage.playReady")}
            </Button>
          )}
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              const group = plan.groups[preparation.day - 1];
              if (selectedDay === group.day) editFirstIncomplete(group);
              else openDay(group.day);
            }}
          >
            {t("library.daily.manage.completeDetails")}
          </Button>
        </div>
      )}
    </div>
  );
  function openDay(day: number) {
    if (preparing) return;
    if (preparation?.day !== day) resetPreparation();
    detailTriggerDay.current = day;
    setSelectedDay(day);
    setSearch("");
    setBulkPickerOpen(false);
    setBulkQuery("");
    setBulkSelected([]);
    setBulkUnassignedOnly(false);
  }

  function addSelectedWords() {
    if (selectedDay === null || !bulkSelected.length) return;
    const moved = bulkSelected.filter((id) => assignedDays.has(id));
    if (
      moved.length &&
      !window.confirm(t("library.daily.manage.confirmMoveMany", { count: moved.length }))
    )
      return;
    if (onBulkAssignWordIds(bulkSelected, selectedDay)) {
      setBulkSelected([]);
      setBulkPickerOpen(false);
    }
  }

  // Account switch never reuses a previous account\u0027s review words.
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
      <section
        id="daily-plan-hero"
        data-testid="daily-plan-hero"
        className="relative overflow-hidden rounded-3xl border border-[#2d627d]/65 bg-[linear-gradient(125deg,#102f45_0%,#15465f_65%,#1a5b74_100%)] text-white shadow-[0_18px_45px_rgba(2,22,37,0.12)]"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -top-28 size-72 rounded-full bg-cyan-300/10 blur-3xl"
        />
        <div className="relative px-5 py-5 sm:px-7 sm:py-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex min-h-8 items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 text-[11px] font-bold tracking-wider text-white">
              <CalendarDays size={14} aria-hidden="true" /> {t("library.daily.manage.heroBadge")}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTourStep(0)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-3 text-xs font-semibold text-white transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
                aria-label={t("library.daily.manage.tourStart")}
              >
                <CircleHelp size={15} aria-hidden="true" /> {t("library.daily.manage.tourStart")}
              </button>
              <button
                id="daily-plan-bulk-add"
                type="button"
                onClick={onBulkAdd}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-3 text-xs font-semibold text-white transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
              >
                <Layers3 size={15} aria-hidden="true" /> {t("library.daily.manage.tourBulkAction")}
              </button>
            </div>
          </div>
          <div className="mt-3 grid items-center gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(285px,322px)]">
            <div className="min-w-0">
              <h2 className="font-display text-[26px] font-semibold leading-tight text-white sm:text-[29px]">
                {t("library.daily.manage.heroTitle")}
              </h2>
              <p className="mt-1.5 max-w-2xl text-[13px] leading-5 text-[#d6eaf4]">
                {t("library.daily.manage.heroDescription")}
              </p>
              <div className="mt-4 max-w-2xl">
                <div className="flex items-center justify-between gap-2 text-xs font-semibold text-white/95">
                  <span>
                    {t("library.daily.manage.learnedProgress", {
                      learned: plan.learned,
                      total: plan.totalWords,
                    })}
                  </span>
                  <span>%{percent}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/20">
                  <div
                    className="h-full rounded-full bg-[#ff9b62] transition-[width] duration-300"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[11px] font-medium text-[#d6eaf4]">
                <span className="inline-flex items-center gap-1.5">
                  <Layers3 size={14} aria-hidden="true" /> {plan.totalWords}{" "}
                  {t("library.daily.manage.plannedShort")}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 size={14} aria-hidden="true" /> {plan.activeDays}{" "}
                  {t("library.daily.manage.activeShort")}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check size={14} aria-hidden="true" /> {plan.completedDays}{" "}
                  {t("library.daily.manage.completedShort")}
                </span>
              </div>
            </div>
            <div
              id="daily-plan-target-selector"
              className="min-w-0 rounded-2xl border border-white/25 bg-white/[0.11] p-3.5 shadow-[0_12px_28px_rgba(0,14,29,0.08)] backdrop-blur-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-white">
                  {t("library.daily.manage.dailyTarget")}
                </p>
              </div>
              <fieldset
                aria-label={t("library.daily.manage.dailyTarget")}
                className="mt-2.5 grid grid-cols-4 gap-1 rounded-xl bg-[#06243a]/60 p-1"
              >
                {dailyGroupSizes.map((size) => (
                  <button
                    key={size}
                    type="button"
                    aria-pressed={groupSize === size}
                    className={`min-h-9 rounded-lg px-2 text-sm font-semibold transition-colors ${groupSize === size ? "shadow-sm" : "text-white hover:bg-white/15"}`}
                    style={
                      groupSize === size
                        ? { backgroundColor: "#ffffff", color: "#123b59" }
                        : undefined
                    }
                    onClick={() => onGroupSizeChange(size)}
                  >
                    {size}
                  </button>
                ))}
              </fieldset>
              <div className="mt-2.5 flex items-center gap-2.5 border-t border-white/10 pt-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/10 p-1">
                  <img
                    src="/brand/atlas-mascot.png"
                    alt="Atlas"
                    draggable={false}
                    className="h-full w-full select-none object-contain"
                  />
                </span>
                <p className="min-w-0 text-[11px] leading-4 text-[#d9e9f1]">
                  <span className="font-semibold text-white">
                    {t("library.daily.manage.atlasTipTitle")} ·{" "}
                  </span>
                  {t("library.daily.manage.targetHint")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

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
                  void Promise.resolve(requestStudy(group))
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
                setClearDay({ day, removal: getDayRemoval(day) });
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
          onClear={() => {
            if (!onClearDay(clearDay.day)) return false;
            if (preparation?.day === clearDay.day) resetPreparation();
            return true;
          }}
          onDelete={async () => {
            await onDeleteDayWords(clearDay.day, clearDay.removal.ids);
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
      <Dialog
        open={selectedDay !== null}
        onOpenChange={(open) => {
          if (!open) {
            cancelStudy();
            setSelectedDay(null);
          }
        }}
      >
        <DialogContent
          className="flex h-[min(88dvh,860px)] max-h-[88dvh] flex-col overflow-hidden rounded-2xl border border-border bg-background p-0 shadow-[0_28px_90px_rgba(0,0,0,0.32)] sm:w-[min(940px,calc(100vw-32px))] max-w-none [&>button:last-child]:hidden"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById(`daily-day-${detailTriggerDay.current}-open`)?.focus();
          }}
        >
          <DialogHeader className="relative z-20 shrink-0 border-b border-border/60 bg-background px-5 py-4 sm:px-6">
            <div className="min-w-0 pr-9">
              <DialogTitle>
                {i18n.language.startsWith("tr")
                  ? `${selectedDay ?? 1}. Gün · Kelimeler`
                  : t("library.daily.manage.dayTitle", { day: selectedDay ?? 1 })}
              </DialogTitle>
              <DialogDescription>{t("library.daily.manage.dayDescription")}</DialogDescription>
            </div>
            <DialogClose asChild>
              <button
                type="button"
                aria-label={t("common.close")}
                title={t("common.close")}
                className="absolute right-4 top-1/2 z-30 grid size-9 -translate-y-1/2 place-items-center rounded-lg border border-border/60 bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </DialogClose>
          </DialogHeader>
          {selectedDay !== null && selectedGroup && (
            <div className="flex min-h-0 flex-1 flex-col">
              <section className="relative z-10 shrink-0 border-b border-border/60 bg-background px-4 py-3 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-baseline gap-2 border-l-[3px] border-[#f27637] py-1 pl-3">
                    <strong className="text-2xl leading-none text-foreground">
                      {selectedGroup.total}
                    </strong>
                    <span className="text-sm text-muted-foreground">
                      {t("library.daily.manage.wordCountLearned", { count: selectedGroup.learned })}
                    </span>
                  </div>
                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                    <DayStudyButton
                      state={detailState}
                      describe={detailStatusId}
                      disabled={preparing}
                      className="min-h-10 flex-1 whitespace-normal px-4 sm:min-w-[112px] sm:flex-none"
                      onClick={() => void requestStudy(selectedGroup)}
                    />

                    <Button
                      className="min-h-10 flex-1 whitespace-normal px-3 sm:flex-none"
                      variant="outline"
                      disabled={preparing || selectedGroup.total === 0}
                      onClick={() => {
                        setSelectedDay(null);
                        setReview({ day: selectedDay, owner: accountId });
                      }}
                    >
                      <RotateCcw size={15} aria-hidden="true" />
                      {t("library.daily.manage.review")}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          className="min-h-10 flex-1 whitespace-normal px-3 sm:flex-none"
                          disabled={preparing || selectedGroup.total >= 40}
                        >
                          <Plus size={15} /> {t("library.daily.manage.addWordMenu")}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="z-[52]">
                        <DropdownMenuItem onSelect={() => onCreateForDay(selectedDay)}>
                          {t("library.daily.manage.newWord")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setBulkPickerOpen((open) => !open)}>
                          {t("library.daily.manage.bulkSelect")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            setSelectedDay(null);
                            onBulkAddForDay(selectedDay);
                          }}
                        >
                          {t("library.daily.manage.bulkWrite")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                {selectedGroup.total > 0 && (
                  <label className="mt-3 flex min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-background px-3.5 py-2.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/10">
                    <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
                      Kelime ara
                    </span>
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={t("library.daily.manage.searchDayPlaceholder")}
                      className="min-h-8 w-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/80 focus-visible:ring-0"
                    />
                  </label>
                )}
              </section>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-background px-4 py-4 [scrollbar-color:var(--color-border)_transparent] sm:px-6">
                {preparation?.day === selectedDay && studyFeedback}
                <DayStudyStatus
                  group={selectedGroup}
                  state={detailState}
                  id={detailStatusId}
                  issue={healthIssue}
                  onRecheck={preparation?.day === selectedDay ? undefined : recheck}
                  onComplete={
                    preparation?.day === selectedDay
                      ? undefined
                      : () => editFirstIncomplete(selectedGroup)
                  }
                />

                {bulkPickerOpen && (
                  <section
                    className="space-y-3 rounded-xl border border-border bg-muted/40 p-3"
                    aria-label={t("library.daily.manage.pickerAria")}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">
                          {t("library.daily.manage.pickerAria")}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {t("library.daily.manage.pickerSummary", {
                            slots: availableSlots,
                            selected: bulkSelected.length,
                          })}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setBulkSelected([])}
                        disabled={preparing || !bulkSelected.length}
                      >
                        {t("library.daily.manage.clearSelection")}
                      </Button>
                    </div>
                    <input
                      type="search"
                      aria-label={t("library.daily.manage.searchToAddAria")}
                      value={bulkQuery}
                      placeholder={t("library.daily.manage.searchPlaceholder")}
                      onChange={(event) => setBulkQuery(event.target.value)}
                      className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-card px-3 text-sm text-foreground"
                    />
                    <label className="inline-flex items-center gap-2 text-xs text-foreground">
                      <input
                        type="checkbox"
                        checked={bulkUnassignedOnly}
                        onChange={(event) => setBulkUnassignedOnly(event.target.checked)}
                      />
                      {t("library.daily.manage.unassignedOnly")}
                    </label>
                    <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-border bg-card p-2">
                      {bulkCandidates.slice(0, 150).map((word) => {
                        const selected = bulkSelected.includes(word.id);
                        return (
                          <label
                            key={word.id}
                            className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-foreground hover:bg-muted"
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={!selected && bulkSelected.length >= availableSlots}
                              onChange={(event) => {
                                const checked = event.currentTarget.checked;
                                setBulkSelected((current) =>
                                  checked
                                    ? [...current, word.id]
                                    : current.filter((id) => id !== word.id),
                                );
                              }}
                            />
                            <span className="min-w-0 flex-1 break-words">
                              {word.word}{" "}
                              <span className="text-xs text-muted-foreground">
                                — {word.meanings[0] || t("library.daily.manage.noMeaning")}
                              </span>
                            </span>
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {assignedDays.has(word.id)
                                ? t("library.daily.manage.assignedDay", {
                                    day: assignedDays.get(word.id),
                                  })
                                : t("library.daily.manage.unassigned")}
                            </span>
                          </label>
                        );
                      })}
                      {!bulkCandidates.length && (
                        <p className="p-3 text-sm text-muted-foreground">
                          {t("library.daily.manage.noCandidate")}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap justify-between gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={availableSlots === 0 || !bulkCandidates.length}
                        onClick={() =>
                          setBulkSelected((current) =>
                            [
                              ...new Set([...current, ...bulkCandidates.map((word) => word.id)]),
                            ].slice(0, availableSlots),
                          )
                        }
                      >
                        {t("library.daily.manage.selectVisible")}
                      </Button>
                      <Button
                        size="sm"
                        onClick={addSelectedWords}
                        disabled={preparing || !bulkSelected.length}
                      >
                        {t("library.daily.manage.addSelected", { count: bulkSelected.length })}
                      </Button>
                    </div>
                  </section>
                )}

                <div className="overflow-hidden rounded-xl border border-border/75 bg-card shadow-sm">
                  {filteredWords.map((word) => (
                    <article
                      key={word.id}
                      className="group/word relative border-b border-border/65 bg-card px-4 py-3 transition-colors last:border-b-0 hover:bg-muted/40 focus-within:bg-muted/40 sm:px-5"
                    >
                      <div className="grid min-w-0 gap-2.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-5">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="break-words text-base text-foreground">
                              {word.word}
                            </strong>
                            <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                              {word.cefr}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {word.partOfSpeech || t("library.daily.manage.unspecifiedType")}
                            </span>
                          </div>
                          <p className="mt-1 break-words text-sm text-muted-foreground">
                            {word.meanings.length
                              ? word.meanings.join(" · ")
                              : t("library.daily.manage.meaningMissing")}
                          </p>
                          {word.examples[0] && (
                            <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground/85">
                              {word.examples[0].sentence}
                            </p>
                          )}
                          {getWordGroup(word.score) !== "learned" && !isDayStudyReady(word) && (
                            <span className="mt-1 inline-block text-[11px] font-medium text-muted-foreground">
                              {t("library.daily.manage.notReady")}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 md:justify-end">
                          <div className="inline-flex min-h-10 min-w-[152px] items-center gap-1.5 rounded-xl border border-border/75 bg-card px-2.5 shadow-sm transition-colors hover:border-ring/50 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15">
                            <ArrowRightLeft
                              size={15}
                              className="shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <label htmlFor={`move-${word.id}`} className="sr-only">
                              {t("library.daily.manage.moveToDay")}
                            </label>
                            <Select
                              value={String(selectedDay)}
                              disabled={
                                preparing ||
                                !plan.groups.some(
                                  (group) => group.day !== selectedDay && group.total < 40,
                                )
                              }
                              onValueChange={(value) => {
                                const target = Number(value);
                                if (target >= 1 && target !== selectedDay)
                                  onAssignWord(word.id, target);
                              }}
                            >
                              <SelectTrigger
                                id={`move-${word.id}`}
                                aria-label={t("library.daily.manage.moveToDay")}
                                className="h-9 min-w-0 flex-1 border-0 bg-transparent px-1 text-xs font-semibold text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-foreground focus-visible:ring-0"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent
                                align="start"
                                className="z-[150] min-w-[174px] border-border bg-popover text-popover-foreground shadow-xl"
                              >
                                <SelectItem
                                  value={String(selectedDay)}
                                  disabled
                                  aria-selected="true"
                                  className="text-foreground data-[state=checked]:text-foreground [&>span:first-child]:text-current"
                                >
                                  {i18n.language.startsWith("tr")
                                    ? `${selectedDay}. Gün`
                                    : t("library.daily.manage.assignedDay", { day: selectedDay })}
                                </SelectItem>
                                {plan.groups
                                  .filter((group) => group.day !== selectedDay && group.total < 40)
                                  .map((group) => (
                                    <SelectItem
                                      key={group.day}
                                      value={String(group.day)}
                                      aria-selected="false"
                                      className="text-foreground focus:bg-muted data-[highlighted]:bg-muted data-[highlighted]:outline-2 data-[highlighted]:outline-solid data-[highlighted]:-outline-offset-2 data-[highlighted]:outline-foreground"
                                    >
                                      {i18n.language.startsWith("tr")
                                        ? `${group.day}. Gün`
                                        : t("library.daily.manage.assignedDay", { day: group.day })}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border/55 bg-card p-0.5">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-9 rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
                              title={t("library.daily.manage.editWord", { word: word.word })}
                              aria-label={t("library.daily.manage.editWord", { word: word.word })}
                              disabled={preparing}
                              onClick={() => onEditWord(word)}
                            >
                              <Pencil size={16} />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-9 rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
                              title={t("library.daily.manage.removeWordTitle")}
                              aria-label={t("library.daily.manage.removeWord", { word: word.word })}
                              disabled={preparing}
                              onClick={() => onRemoveFromDay(word.id, selectedDay)}
                            >
                              <XCircle size={16} />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-9 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              title={t("library.daily.manage.deleteWordTitle")}
                              aria-label={t("library.daily.manage.deleteWord", { word: word.word })}
                              disabled={preparing}
                              onClick={() => onDeleteWord(word)}
                            >
                              <Trash2 size={16} />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                  {selectedGroup.total === 0 && (
                    <div className="rounded-xl border border-dashed border-border p-6 text-center">
                      <p className="font-semibold text-foreground">
                        {t("library.daily.manage.emptyDayTitle")}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("library.daily.manage.emptyDayHint")}
                      </p>
                    </div>
                  )}
                  {selectedGroup.total > 0 && filteredWords.length === 0 && (
                    <p className="rounded-lg border border-border p-5 text-center text-sm text-muted-foreground">
                      {t("library.daily.manage.noSearchResults")}
                    </p>
                  )}
                </div>
                <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
                  {t("library.daily.manage.localOnly")}
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
