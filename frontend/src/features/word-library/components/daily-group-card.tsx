import { ArrowUpRight, CircleHelp, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { type DailyGroup, missingStudyContent, reviewableWords } from "../model/daily-groups";
import type { DayStudyState } from "../model/day-study-state";
import { DayStudyButton, DayStudyStatusText } from "./day-study-action";

export function DailyGroupCard({
  group,
  targetSize,
  onOpen,
  onStudy,
  onReview,
  onClear,
  busy,
  studyState,
  healthIssue,
  onComplete,
  canCompleteContent,
  preparationProgress,
  preparationNotice,
}: {
  group: DailyGroup;
  targetSize: number;
  onOpen: (day: number) => void;
  onStudy: (group: DailyGroup) => void;
  onReview: (group: DailyGroup) => void;
  onClear: (day: number) => void;
  busy: boolean;
  studyState: DayStudyState;
  healthIssue?: string;
  onRecheck?: () => void;
  onComplete?: (group: DailyGroup) => void;
  canCompleteContent: boolean;
  preparationProgress?: { ready: number; total: number };
  preparationNotice?: string;
}) {
  const { t, i18n } = useTranslation();
  const statusId = useId();
  const missing = group.words.map(missingStudyContent).filter((fields) => fields.length);
  const [hintOpen, setHintOpen] = useState(false);
  const hintRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!hintOpen) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!hintRef.current?.contains(event.target as Node)) setHintOpen(false);
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHintOpen(false);
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissEscape);
    };
  }, [hintOpen]);
  const isPreparingThisDay = preparationProgress !== undefined;
  const isEmpty = group.total === 0;
  const isDone = group.total > 0 && group.learned === group.total;
  const percentage = group.total ? Math.round(group.progress * 100) : 0;

  if (isEmpty) {
    return (
      <button
        id={`daily-day-${group.day}-open`}
        type="button"
        disabled={busy}
        onClick={() => onOpen(group.day)}
        className="group flex min-h-28 flex-col justify-between gap-4 rounded-2xl border border-dashed border-border bg-card/40 p-4 text-left transition-colors hover:border-[#f27637] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f27637]"
        aria-label={t("library.daily.manage.emptyCardAria", { day: group.day })}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-muted-foreground">
            {i18n.language.startsWith("tr")
              ? `${group.day}. Gün`
              : t("library.daily.manage.dayCardLabel", { day: group.day })}
          </span>
          <Plus
            size={18}
            className="text-muted-foreground transition-colors group-hover:text-[#f27637]"
          />
        </div>
        <span className="text-sm font-semibold text-foreground">
          {t("library.daily.manage.addToEmptyCard")}
        </span>
      </button>
    );
  }

  return (
    <article className="relative z-0 min-w-0 self-start overflow-visible rounded-2xl border border-border bg-card text-card-foreground shadow-sm transition-[border-color,box-shadow] hover:z-10 hover:border-border/80 hover:shadow-md focus-within:z-20">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-5">
        <span className="text-xs font-bold tracking-wider text-muted-foreground">
          {i18n.language.startsWith("tr")
            ? `${group.day}. Gün`
            : t("library.daily.manage.dayCardLabel", { day: group.day })}
        </span>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-atlas-orange-pale px-2.5 py-1 text-[11px] font-semibold text-atlas-orange-dark">
            {t("library.daily.manage.wordTarget", { count: group.total, target: targetSize })}
          </span>
          <Button
            id={`daily-day-${group.day}-remove`}
            aria-label={t("library.daily.manage.clearDayTitle", { day: group.day })}
            className="size-9 shrink-0 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            size="icon"
            variant="ghost"
            disabled={busy}
            onClick={() => onClear(group.day)}
          >
            <Trash2 size={16} aria-hidden="true" />
          </Button>
        </div>
      </div>
      <button
        id={`daily-day-${group.day}-open`}
        type="button"
        disabled={busy}
        onClick={() => onOpen(group.day)}
        className="flex w-full flex-col gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#f27637] sm:px-5"
        aria-label={t("library.daily.manage.filledCardAria", {
          day: group.day,
          count: group.total,
        })}
      >
        <div className="flex w-full items-end justify-between gap-3">
          <div>
            <strong className="block text-2xl leading-none text-foreground">
              {group.learned}
              <span className="text-base font-medium text-muted-foreground">/{group.total}</span>
            </strong>
            <span className="mt-1 block text-xs text-muted-foreground">
              {t(isDone ? "library.daily.manage.completed" : "library.daily.manage.learnedWord")}
            </span>
          </div>
          <ArrowUpRight size={19} className="text-muted-foreground" />
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${isDone ? "bg-emerald-500" : "bg-[#f27637]"}`}
            style={{ width: `${percentage}%` }}
          />
        </div>
        <p className="w-full truncate text-xs text-muted-foreground">
          {group.words
            .slice(0, 4)
            .map((word) => word.word)
            .join(" · ")}
          {group.total > 4 ? ` · +${group.total - 4}` : ""}
        </p>
      </button>
      {preparationProgress && (
        <div
          aria-hidden="true"
          className="absolute bottom-0 left-0 right-0 z-[1] h-1 overflow-hidden rounded-b-2xl bg-amber-500/15"
        >
          <div
            className="h-full bg-[#f27637] transition-[width] duration-200"
            style={{
              width: `${(100 * preparationProgress.ready) / Math.max(1, preparationProgress.total)}%`,
            }}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 rounded-b-2xl border-t border-border px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
          <span className="font-semibold text-orange-600">
            {t("library.daily.manage.hardCount", { count: group.hard })}
          </span>
          <span>{t("library.daily.manage.reviewCount", { count: group.review })}</span>
          <span className="text-emerald-600">
            {t("library.daily.manage.learnedCount", { count: group.learned })}
          </span>
          {studyState === "ready" ? (
            <span>
              {t("library.daily.manage.preparedCount", {
                ready: group.playable,
                total: group.total - group.learned,
              })}
            </span>
          ) : (
            <span
              ref={hintRef}
              className="relative inline-flex items-center"
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse" || event.pointerType === "pen") setHintOpen(true);
              }}
              onPointerLeave={(event) => {
                if (event.pointerType !== "touch") setHintOpen(false);
              }}
            >
              <span id={statusId} className="sr-only">
                <DayStudyStatusText group={group} state={studyState} issue={healthIssue} />
              </span>
              <button
                type="button"
                aria-label={t("library.daily.manage.preparedCount", {
                  ready: group.playable,
                  total: group.total - group.learned,
                })}
                aria-describedby={statusId}
                className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 text-[11px] font-medium text-amber-700 transition-colors hover:border-amber-400/50 hover:bg-amber-400/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-atlas-blue dark:text-amber-300"
                aria-haspopup="dialog"
                aria-expanded={hintOpen}
                onFocus={() => setHintOpen(true)}
                onBlur={(event) => {
                  if (!hintRef.current?.contains(event.relatedTarget)) setHintOpen(false);
                }}
                onClick={() => setHintOpen(true)}
              >
                <CircleHelp size={14} aria-hidden="true" />
                {t("library.daily.manage.preparedCount", {
                  ready: group.playable,
                  total: group.total - group.learned,
                })}
              </button>
              {hintOpen && (
                <div className="absolute bottom-full left-0 z-50 w-[min(340px,calc(100vw-2rem))] pb-2">
                  <div
                    id={`${statusId}-hint`}
                    role="dialog"
                    aria-label="Hazır değil"
                    className="overflow-hidden rounded-2xl border border-border/80 bg-popover text-popover-foreground shadow-[0_22px_60px_rgba(0,0,0,0.28)] ring-1 ring-foreground/5"
                  >
                    <div className="flex items-start gap-3 px-4 pb-3 pt-4">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-amber-400/25 bg-amber-400/10 text-amber-600 dark:text-amber-300">
                        <CircleHelp size={17} aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold leading-5 text-foreground">
                          Çalışmaya hazır değil
                        </p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {group.playable} / {group.total - group.learned} kelime hazır. Devam etmek
                          için eksik anlam ve örnek cümleleri tamamla.
                        </p>
                        {healthIssue && (
                          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                            {healthIssue}
                          </p>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onBlur={(event) => {
                        if (!hintRef.current?.contains(event.relatedTarget)) setHintOpen(false);
                      }}
                      className="flex min-h-11 w-full items-center justify-between border-t border-border/70 bg-muted/25 px-4 text-left text-xs font-semibold text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-atlas-blue"
                      onClick={() => {
                        setHintOpen(false);
                        if (onComplete) onComplete(group);
                        else onOpen(group.day);
                      }}
                    >
                      {isPreparingThisDay
                        ? t("library.daily.manage.preparationProgress")
                        : onComplete
                          ? t("library.daily.manage.prepareStudy")
                          : t("library.daily.manage.completeDetails")}
                      <ArrowUpRight
                        size={15}
                        className="text-muted-foreground"
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </div>
              )}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DayStudyButton
            state={studyState}
            day={group.day}
            describe={statusId}
            size="sm"
            disabled={busy}
            className="min-h-9 shrink-0 px-3"
            onClick={() => onStudy(group)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !reviewableWords(group).length}
            className="min-h-9 shrink-0 px-3"
            aria-label={t("library.daily.manage.reviewCardAria", { day: group.day })}
            onClick={() => onReview(group)}
          >
            <RotateCcw size={14} aria-hidden="true" /> {t("library.daily.manage.review")}
          </Button>
        </div>
      </div>
      {preparationNotice && (
        <p
          role="status"
          className="border-t border-amber-500/15 bg-amber-500/5 px-4 py-2.5 text-xs leading-5 text-foreground sm:px-5"
        >
          {preparationNotice}
        </p>
      )}
      {canCompleteContent && missing.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <span>
            {t("library.daily.manage.missingContent", {
              meanings: missing.filter((fields) => fields.includes("meaning")).length,
              examples: missing.filter((fields) => fields.includes("examples")).length,
            })}
          </span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onComplete?.(group)}>
            {t("library.daily.manage.completeMissing", { count: missing.length })}
          </Button>
        </div>
      )}
    </article>
  );
}
