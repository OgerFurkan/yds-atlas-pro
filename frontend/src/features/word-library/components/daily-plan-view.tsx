import type { WordEntry } from "@yds-atlas/shared";
import {
  ArrowRightLeft,
  BookOpenCheck,
  CalendarDays,
  CircleHelp,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Layers3,
  Pencil,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { GuidedTour, type GuideStep } from "@/shared/ui/guided-tour";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { LibraryEmpty } from "@/features/word-library/components/library-status";
import {
  type DailyGroup,
  type DailyPlan,
  dailyGroupSizes,
} from "@/features/word-library/model/daily-groups";
import { DailyGroupCard } from "./daily-group-card";
import { DailyPlanSyncPreview } from "./daily-plan-sync-preview";

export function DailyPlanView({
  plan,
  groupSize,
  words,
  cloudPreflightUserId,
  error,
  onGroupSizeChange,
  onStudyGroup,
  onAddWord,
  onBulkAdd,
  onBulkAddForDay,
  onBulkAssignWordIds,
  onCreateForDay,
  onAssignWord,
  onRemoveFromDay,
  onEditWord,
  onDeleteWord,
}: {
  plan: DailyPlan;
  groupSize: number;
  words: WordEntry[];
  cloudPreflightUserId?: string | null;
  error?: string;
  onGroupSizeChange: (size: number) => void;
  onStudyGroup: (group: DailyGroup) => void;
  onAddWord: () => void;
  onBulkAdd: () => void;
  onBulkAddForDay: (day: number) => void;
  onBulkAssignWordIds: (wordIds: string[], day: number) => boolean;
  onCreateForDay: (day: number) => void;
  onAssignWord: (wordId: string, day: number) => void;
  onRemoveFromDay: (wordId: string, day: number) => void;
  onEditWord: (word: WordEntry) => void;
  onDeleteWord: (word: WordEntry) => void;
}) {
  const { t } = useTranslation();
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
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
    { id: "overview", target: "#daily-plan-hero", title: t("library.daily.manage.tourOverviewTitle"), description: t("library.daily.manage.tourOverviewDescription") },
    { id: "target", target: "#daily-plan-target-selector", title: t("library.daily.manage.tourTargetTitle"), description: t("library.daily.manage.tourTargetDescription") },
    { id: "days", target: "#daily-plan-groups", title: t("library.daily.manage.tourDaysTitle"), description: t("library.daily.manage.tourDaysDescription") },
    { id: "bulk", target: "#daily-plan-bulk-add", title: t("library.daily.manage.tourBulkTitle"), description: t("library.daily.manage.tourBulkDescription") },
    { id: "study", target: "#daily-plan-study-area", title: t("library.daily.manage.tourStudyTitle"), description: t("library.daily.manage.tourStudyDescription") },
  ];
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");
  const [wordToAdd, setWordToAdd] = useState("");
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
    () => words.filter((word) => assignedDays.get(word.id) !== selectedDay)
      .sort((a, b) => a.word.localeCompare(b.word)),
    [words, assignedDays, selectedDay],
  );
  const bulkCandidates = availableWords.filter((word) =>
    (!bulkUnassignedOnly || !assignedDays.has(word.id)) &&
    `${word.word} ${word.meanings.join(" ")}`.toLocaleLowerCase("tr")
      .includes(bulkQuery.trim().toLocaleLowerCase("tr")),
  );
  const availableSlots = Math.max(0, 40 - (selectedGroup?.total ?? 0));
  const filteredWords = selectedGroup?.words.filter((word) =>
    `${word.word} ${word.meanings.join(" ")}`.toLocaleLowerCase("tr")
      .includes(search.trim().toLocaleLowerCase("tr")),
  ) ?? [];

  function openDay(day: number) {
    setSelectedDay(day);
    setSearch("");
    setWordToAdd("");
    setBulkPickerOpen(false);
    setBulkQuery("");
    setBulkSelected([]);
    setBulkUnassignedOnly(false);
  }

  function addExistingWord() {
    if (!wordToAdd || selectedDay === null) return;
    const existingDay = assignedDays.get(wordToAdd);
    if (existingDay && existingDay !== selectedDay &&
      !window.confirm(t("library.daily.manage.confirmMoveOne", { from: existingDay, to: selectedDay })))
      return;
    onAssignWord(wordToAdd, selectedDay);
    setWordToAdd("");
  }

  function addSelectedWords() {
    if (selectedDay === null || !bulkSelected.length) return;
    const moved = bulkSelected.filter((id) => assignedDays.has(id));
    if (moved.length && !window.confirm(
      t("library.daily.manage.confirmMoveMany", { count: moved.length }),
    )) return;
    if (onBulkAssignWordIds(bulkSelected, selectedDay)) {
      setBulkSelected([]);
      setBulkPickerOpen(false);
    }
  }

  return (
    <div className="mt-4 space-y-5">
      <section id="daily-plan-hero" data-testid="daily-plan-hero" className="overflow-hidden rounded-2xl border border-[#28658b] bg-gradient-to-br from-[#103b58] via-[#164c6c] to-[#1b7095] text-white shadow-sm">
        <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-bold tracking-widest text-white">
                <CalendarDays size={14} /> {t("library.daily.manage.heroBadge")}
              </span>
              <button type="button" onClick={() => setTourStep(0)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 text-xs font-semibold text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white" aria-label={t("library.daily.manage.tourStart")}>
                <CircleHelp size={15} /> {t("library.daily.manage.tourStart")}
              </button>
              <button id="daily-plan-bulk-add" type="button" onClick={onBulkAdd} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-white/25 px-3 text-xs font-semibold text-white hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white">
                <Layers3 size={15} /> {t("library.daily.manage.tourBulkAction")}
              </button>
            </div>
            <h2 className="mt-3 font-display text-2xl font-semibold leading-snug text-white sm:text-3xl">
              {t("library.daily.manage.heroTitle")}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[#e0f1f9]">
              {t("library.daily.manage.heroDescription")}
            </p>
            <div className="mt-5 max-w-xl">
              <div className="flex items-center justify-between gap-2 text-xs font-semibold text-white">
                <span>{t("library.daily.manage.learnedProgress", { learned: plan.learned, total: plan.totalWords })}</span>
                <span>%{percent}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/25">
                <div className="h-full rounded-full bg-[#ff9b62] transition-[width] duration-300" style={{ width: `${percent}%` }} />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-white">
              <span className="inline-flex items-center gap-1.5"><Layers3 size={15} /> {plan.totalWords} {t("library.daily.manage.plannedShort")}</span>
              <span className="inline-flex items-center gap-1.5"><Clock3 size={15} /> {plan.activeDays} {t("library.daily.manage.activeShort")}</span>
              <span className="inline-flex items-center gap-1.5"><Check size={15} /> {plan.completedDays} {t("library.daily.manage.completedShort")}</span>
            </div>
          </div>
          <div className="flex min-w-0 items-center justify-end">
            <div id="daily-plan-target-selector" className="w-full min-w-0 rounded-2xl border border-white/25 bg-[#0a314c]/70 p-4 shadow-[0_15px_35px_rgba(0,15,32,0.16)]">
              <div className="mb-3 flex items-center gap-3 border-b border-white/15 pb-3">
                <span className="grid size-16 shrink-0 place-items-center rounded-xl bg-white/10 p-1.5">
                  <img src="/brand/atlas-mascot.png" alt="Atlas" draggable={false} className="h-full w-full select-none object-contain drop-shadow-md" />
                </span>
                <div className="min-w-0">
                  <strong className="block text-xs font-bold text-white">{t("library.daily.manage.atlasTipTitle")}</strong>
                  <p className="mt-1 text-[11px] leading-relaxed text-[#e0f1f9]">{t("library.daily.manage.atlasTip")}</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-white">{t("library.daily.manage.dailyTarget")}</p>
                <strong className="text-2xl text-white">{groupSize}</strong>
              </div>
              <div role="group" aria-label={t("library.daily.manage.dailyTarget")} className="mt-3 grid grid-cols-4 gap-1 rounded-xl bg-[#082a43] p-1">
                {dailyGroupSizes.map((size) => (
                  <button
                    key={size}
                    type="button"
                    aria-pressed={groupSize === size}
                    className={`rounded-lg px-2 py-2 text-sm font-semibold transition-colors ${groupSize === size ? "bg-[#ffffff] text-[#123b59] shadow-sm" : "text-white hover:bg-white/15"}`}
                    onClick={() => onGroupSizeChange(size)}
                  >{size}</button>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-[#e0f1f9]">
                {t("library.daily.manage.targetHint")}
              </p>
            </div>
          </div>
        </div>
      </section>

      <DailyPlanSyncPreview userId={cloudPreflightUserId ?? null} words={words} />

      {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {plan.overflow > 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {t("library.daily.manage.overflow", { count: plan.overflow })}
        </p>
      )}

      {plan.totalWords === 0 && words.length === 0 && (
        <LibraryEmpty onAdd={onAddWord} onBulk={onBulkAdd} />
      )}

      <section id="daily-plan-groups" aria-label={t("library.daily.gridAria")}>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-foreground">{t("library.daily.manage.groupsHeading")}</h3>
            <p className="text-xs text-muted-foreground">{t("library.daily.manage.groupsHint")}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowAll((current) => !current)}>
            {showAll ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            {showAll ? t("library.daily.manage.hideEmpty") : t("library.daily.manage.showAll")}
          </Button>
        </div>
        <div id="daily-plan-study-area" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleGroups.map((group) => (
            <DailyGroupCard
              key={group.day}
              group={group}
              targetSize={groupSize}
              onOpen={openDay}
              onStudy={onStudyGroup}
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
          onNext={() => setTourStep((current) => current === null || current >= tourSteps.length - 1 ? null : current + 1)}
          onExit={() => setTourStep(null)}
        />
      )}
      <Dialog open={selectedDay !== null} onOpenChange={(open) => { if (!open) setSelectedDay(null); }}>
        <DialogContent className="!w-[min(880px,calc(100vw-24px))] max-w-none">
          <DialogHeader>
            <div className="min-w-0 pr-9">
              <DialogTitle>{t("library.daily.manage.dayTitle", { day: selectedDay ?? 1 })}</DialogTitle>
              <DialogDescription>
                {t("library.daily.manage.dayDescription")}
              </DialogDescription>
            </div>
          </DialogHeader>
          {selectedDay !== null && selectedGroup && (
            <div className="space-y-5 p-4 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <strong className="text-2xl text-foreground">{selectedGroup.total}</strong>
                  <span className="ml-2 text-sm text-muted-foreground">{t("library.daily.manage.wordCountLearned", { count: selectedGroup.learned })}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={selectedGroup.total >= 40} onClick={() => onCreateForDay(selectedDay)}><Plus size={16} /> {t("library.daily.manage.newWord")}</Button>
                  <Button size="sm" variant="outline" disabled={selectedGroup.total >= 40} onClick={() => setBulkPickerOpen((open) => !open)}>
                    <Layers3 size={16} /> {t("library.daily.manage.bulkSelect")}
                  </Button>
                  <Button size="sm" variant="outline" disabled={selectedGroup.total >= 40} onClick={() => {
                    setSelectedDay(null);
                    onBulkAddForDay(selectedDay);
                  }}>
                    <Plus size={16} /> {t("library.daily.manage.bulkWrite")}
                  </Button>
                  <Button
                    size="sm" variant="outline" disabled={selectedGroup.playable === 0}
                    onClick={() => onStudyGroup(selectedGroup)}
                  ><BookOpenCheck size={15} /> {t("library.daily.manage.studyDay")}</Button>
                </div>
              </div>

              {bulkPickerOpen && (
                <section className="space-y-3 rounded-xl border border-border bg-muted/40 p-3" aria-label={t("library.daily.manage.pickerAria")}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">{t("library.daily.manage.pickerAria")}</h3>
                      <p className="text-xs text-muted-foreground">{t("library.daily.manage.pickerSummary", { slots: availableSlots, selected: bulkSelected.length })}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setBulkSelected([])} disabled={!bulkSelected.length}>{t("library.daily.manage.clearSelection")}</Button>
                  </div>
                  <input
                    type="search" aria-label={t("library.daily.manage.searchToAddAria")} value={bulkQuery}
                    placeholder={t("library.daily.manage.searchPlaceholder")}
                    onChange={(event) => setBulkQuery(event.target.value)}
                    className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-card px-3 text-sm text-foreground"
                  />
                  <label className="inline-flex items-center gap-2 text-xs text-foreground">
                    <input type="checkbox" checked={bulkUnassignedOnly} onChange={(event) => setBulkUnassignedOnly(event.target.checked)} />
                    {t("library.daily.manage.unassignedOnly")}
                  </label>
                  <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-border bg-card p-2">
                    {bulkCandidates.slice(0, 150).map((word) => {
                      const selected = bulkSelected.includes(word.id);
                      return (
                        <label key={word.id} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-foreground hover:bg-muted">
                          <input
                            type="checkbox" checked={selected} disabled={!selected && bulkSelected.length >= availableSlots}
                            onChange={(event) => {
                              const checked = event.currentTarget.checked;
                              setBulkSelected((current) => checked
                                ? [...current, word.id]
                                : current.filter((id) => id !== word.id));
                            }}
                          />
                          <span className="min-w-0 flex-1 break-words">{word.word} <span className="text-xs text-muted-foreground">— {word.meanings[0] || t("library.daily.manage.noMeaning")}</span></span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">{assignedDays.has(word.id) ? t("library.daily.manage.assignedDay", { day: assignedDays.get(word.id) }) : t("library.daily.manage.unassigned")}</span>
                        </label>
                      );
                    })}
                    {!bulkCandidates.length && <p className="p-3 text-sm text-muted-foreground">{t("library.daily.manage.noCandidate")}</p>}
                  </div>
                  <div className="flex flex-wrap justify-between gap-2">
                    <Button size="sm" variant="outline" disabled={availableSlots === 0 || !bulkCandidates.length} onClick={() =>
                      setBulkSelected((current) => [...new Set([...current, ...bulkCandidates.map((word) => word.id)])].slice(0, availableSlots))
                    }>{t("library.daily.manage.selectVisible")}</Button>
                    <Button size="sm" onClick={addSelectedWords} disabled={!bulkSelected.length}>{t("library.daily.manage.addSelected", { count: bulkSelected.length })}</Button>
                  </div>
                </section>
              )}

              <div className="rounded-xl border border-border bg-muted/40 p-3">
                <label htmlFor="day-word-add" className="mb-2 block text-xs font-semibold text-foreground">
                  {t("library.daily.manage.addExisting")}
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select
                    id="day-word-add"
                    value={wordToAdd}
                    onChange={(event) => setWordToAdd(event.target.value)}
                    className="min-h-10 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 text-sm text-foreground"
                  >
                    <option value="">{t("library.daily.manage.chooseWord", { count: availableWords.length })}</option>
                    {availableWords.map((word) => (
                      <option key={word.id} value={word.id}>
                        {word.word} — {word.meanings[0] || t("library.daily.manage.noMeaning")}{assignedDays.has(word.id) ? ` (${t("library.daily.manage.assignedDay", { day: assignedDays.get(word.id) })})` : ` (${t("library.daily.manage.unassigned").toLocaleLowerCase()})`}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" disabled={!wordToAdd || selectedGroup.total >= 40} onClick={addExistingWord}>
                    <Plus size={15} /> {t("library.daily.manage.addToDay")}
                  </Button>
                </div>
                {selectedGroup.total >= 40 && <p className="mt-2 text-xs text-orange-700">{t("library.daily.manage.maxWords")}</p>}
              </div>

              {selectedGroup.total > 0 && (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-foreground">{t("library.daily.manage.searchDay")}</span>
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t("library.daily.manage.searchDayPlaceholder")}
                    className="min-h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground"
                  />
                </label>
              )}

              <div className="space-y-2">
                {filteredWords.map((word) => (
                  <article key={word.id} className="rounded-xl border border-border bg-card p-3 sm:p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="break-words text-base text-foreground">{word.word}</strong>
                          <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">{word.cefr}</span>
                          <span className="text-xs text-muted-foreground">{word.partOfSpeech || t("library.daily.manage.unspecifiedType")}</span>
                        </div>
                        <p className="mt-1 break-words text-sm text-muted-foreground">
                          {word.meanings.length ? word.meanings.join(" · ") : t("library.daily.manage.meaningMissing")}
                        </p>
                        {word.examples[0] && (
                          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                            {word.examples[0].sentence}
                          </p>
                        )}
                        {!selectedGroup.playableWords.some((ready) => ready.id === word.id) && (
                          <span className="mt-1 inline-block text-[11px] font-medium text-orange-600">
                            {t("library.daily.manage.notReady")}
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button size="icon" variant="ghost" title={t("library.daily.manage.editWord", { word: word.word })} aria-label={t("library.daily.manage.editWord", { word: word.word })} onClick={() => onEditWord(word)}>
                          <Pencil size={16} />
                        </Button>
                        <Button size="icon" variant="ghost" title={t("library.daily.manage.removeWordTitle")} aria-label={t("library.daily.manage.removeWord", { word: word.word })} onClick={() => onRemoveFromDay(word.id, selectedDay)}>
                          <XCircle size={16} />
                        </Button>
                        <Button size="icon" variant="ghost" title={t("library.daily.manage.deleteWordTitle")} aria-label={t("library.daily.manage.deleteWord", { word: word.word })} onClick={() => onDeleteWord(word)}>
                          <Trash2 size={16} className="text-red-600" />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-2">
                      <ArrowRightLeft size={14} className="text-muted-foreground" />
                      <label htmlFor={`move-${word.id}`} className="text-xs text-muted-foreground">{t("library.daily.manage.moveToDay")}</label>
                      <select
                        id={`move-${word.id}`}
                        value={selectedDay}
                        onChange={(event) => onAssignWord(word.id, Number(event.target.value))}
                        className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground"
                      >
                        {plan.groups.filter((group) => group.day === selectedDay || group.total < 40).map((group) => (
                          <option key={group.day} value={group.day}>{t("library.daily.manage.assignedDay", { day: group.day })}</option>
                        ))}
                      </select>
                    </div>
                  </article>
                ))}
                {selectedGroup.total === 0 && (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center">
                    <p className="font-semibold text-foreground">{t("library.daily.manage.emptyDayTitle")}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{t("library.daily.manage.emptyDayHint")}</p>
                  </div>
                )}
                {selectedGroup.total > 0 && filteredWords.length === 0 && (
                  <p className="rounded-lg border border-border p-5 text-center text-sm text-muted-foreground">{t("library.daily.manage.noSearchResults")}</p>
                )}
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {t("library.daily.manage.localOnly")}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
