import type { WordEntry } from "@yds-atlas/shared";
import { Plus, RotateCcw, X } from "lucide-react";
import { type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
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
import type { useDayStudy } from "../hooks/use-day-study";
import type { DailyGroup, DailyPlan } from "../model/daily-groups";
import { DayStudyButton, DayStudyStatus } from "./day-study-action";
import { DayWordList } from "./day-word-list";
import { DayWordPicker } from "./day-word-picker";

export function DailyPlanDayDialog({
  selectedDay,
  search,
  setSearch,
  bulkPickerOpen,
  setBulkPickerOpen,
  editFirstIncomplete,
  plan,
  words,
  triggerDay,
  studyFeedback,
  detailStatusId,
  study,
  onClose,
  onReview,
  recheck,
  onCreateForDay,
  onBulkAddForDay,
  onBulkAssignWordIds,
  onAssignWord,
  onRemoveFromDay,
  onEditWord,
  onDeleteWord,
}: {
  selectedDay: number | null;
  search: string;
  setSearch: (value: string) => void;
  bulkPickerOpen: boolean;
  setBulkPickerOpen: Dispatch<SetStateAction<boolean>>;
  editFirstIncomplete: (group: DailyGroup) => void;
  plan: DailyPlan;
  words: WordEntry[];
  triggerDay: RefObject<number | null>;
  studyFeedback: ReactNode;
  detailStatusId: string;
  study: ReturnType<typeof useDayStudy>;
  onClose: () => void;
  onReview: (day: number) => void;
  recheck: () => void;
  onCreateForDay: (day: number) => void;
  onBulkAddForDay: (day: number) => void;
  onBulkAssignWordIds: (ids: string[], day: number) => Promise<boolean>;
  onAssignWord: (id: string, day: number) => void;
  onRemoveFromDay: (id: string, day: number) => void;
  onEditWord: (word: WordEntry) => void;
  onDeleteWord: (word: WordEntry) => void;
}) {
  const { t, i18n } = useTranslation();
  const selectedGroup = selectedDay === null ? undefined : plan.groups[selectedDay - 1];
  const { preparation, preparing, stateFor, healthIssue, cancelStudy, requestStudy } = study;
  const detailState = selectedGroup ? stateFor(selectedGroup) : "empty";
  const filteredWords =
    selectedGroup?.words.filter((word) =>
      `${word.word} ${word.meanings.join(" ")}`
        .toLocaleLowerCase("tr")
        .includes(search.trim().toLocaleLowerCase("tr")),
    ) ?? [];

  return (
    <Dialog
      open={selectedDay !== null}
      onOpenChange={(open) => {
        if (!open) {
          cancelStudy();
          onClose();
        }
      }}
    >
      <DialogContent
        className="flex h-[min(88dvh,860px)] max-h-[88dvh] flex-col overflow-hidden rounded-2xl border border-border bg-background p-0 shadow-[0_28px_90px_rgba(0,0,0,0.32)] sm:w-[min(940px,calc(100vw-32px))] max-w-none [&>button:last-child]:hidden"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById(`daily-day-${triggerDay.current}-open`)?.focus();
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
                      onReview(selectedDay);
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
                          onClose();
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

              <DayWordPicker
                open={bulkPickerOpen}
                groups={plan.groups}
                words={words}
                selectedDay={selectedDay}
                total={selectedGroup.total}
                preparing={preparing}
                onBulkAssignWordIds={onBulkAssignWordIds}
                onClose={() => setBulkPickerOpen(false)}
              />

              <DayWordList
                words={filteredWords}
                group={selectedGroup}
                groups={plan.groups}
                preparing={preparing}
                onAssignWord={onAssignWord}
                onEditWord={onEditWord}
                onRemoveFromDay={onRemoveFromDay}
                onDeleteWord={onDeleteWord}
              />
              <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
                {t("library.daily.manage.localOnly")}
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
