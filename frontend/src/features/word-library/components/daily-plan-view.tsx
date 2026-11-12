import { CalendarDays, Check, Clock3, Layers3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LibraryEmpty } from "@/features/word-library/components/library-status";
import {
  type DailyGroup,
  type DailyPlan,
  dailyGroupSizes,
} from "@/features/word-library/model/daily-groups";
import { DailyGroupCard } from "./daily-group-card";

export function DailyPlanView({
  plan,
  groupSize,
  onGroupSizeChange,
  onStudyGroup,
  onAddWord,
  onBulkAdd,
}: {
  plan: DailyPlan;
  groupSize: number;
  onGroupSizeChange: (size: number) => void;
  onStudyGroup: (group: DailyGroup) => void;
  onAddWord: () => void;
  onBulkAdd: () => void;
}) {
  const { t } = useTranslation();

  if (!plan.totalWords)
    return (
      <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-5 sm:p-6">
          <span className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-[10px] font-bold tracking-[.14em] text-atlas-blue">
            <CalendarDays size={13} /> {t("library.daily.badge")}
          </span>
          <h2 className="mt-3 font-display text-2xl font-medium text-atlas-navy">
            {t("library.daily.emptyTitle")}
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-atlas-muted">
            {t("library.daily.emptyDescription")}
          </p>
        </div>
        <LibraryEmpty onAdd={onAddWord} onBulk={onBulkAdd} />
      </section>
    );

  const percent = Math.round((plan.learned / plan.totalWords) * 100);

  return (
    <div className="mt-4 space-y-5">
      <section className="overflow-hidden rounded-2xl border border-sky-100 bg-gradient-to-br from-atlas-navy via-atlas-navy to-atlas-blue text-white shadow-sm">
        <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-center">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold tracking-[.14em] text-sky-100 ring-1 ring-white/15">
              <CalendarDays size={13} /> {t("library.daily.badge")}
            </span>
            <h2 className="mt-3 font-display text-2xl font-medium sm:text-3xl">
              {t("library.daily.title")}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-sky-100">
              {t("library.daily.subtitle")}
            </p>

            <div className="mt-5 max-w-xl">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-sky-100">
                <span>
                  {t("library.daily.learnedSummary", {
                    learned: plan.learned,
                    total: plan.totalWords,
                  })}
                </span>
                <span>%{percent}</span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-atlas-orange to-amber-300 transition-[width] duration-500"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-sky-100">
              <span className="inline-flex items-center gap-1.5">
                <Layers3 size={14} className="text-atlas-orange" />
                <strong className="text-white">{plan.totalWords}</strong>{" "}
                {t("library.daily.plannedWords")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock3 size={14} className="text-sky-200" />
                <strong className="text-white">{plan.activeDays}</strong>{" "}
                {t("library.daily.activeDays")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check size={14} className="text-emerald-300" />
                <strong className="text-white">{plan.completedDays}</strong>{" "}
                {t("library.daily.completedDays")}
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-sky-100">{t("library.daily.groupSize")}</p>
              <span className="text-xl leading-none font-bold text-white">{groupSize}</span>
            </div>
            <div
              role="group"
              aria-label={t("library.daily.groupSize")}
              className="mt-3 grid grid-cols-4 gap-1 rounded-xl bg-atlas-navy/35 p-1"
            >
              {dailyGroupSizes.map((size) => (
                <button
                  key={size}
                  type="button"
                  aria-pressed={groupSize === size}
                  className={`rounded-lg px-1 py-1.5 text-sm font-semibold transition-colors ${
                    groupSize === size
                      ? "bg-white text-atlas-navy shadow-sm"
                      : "text-sky-100 hover:bg-white/10"
                  }`}
                  onClick={() => onGroupSizeChange(size)}
                >
                  {size}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-4 text-sky-200">
              {t("library.daily.groupSizeHint")}
            </p>
          </div>
        </div>
        {plan.overflow > 0 && (
          <p className="border-t border-white/10 bg-amber-400/10 px-5 py-2.5 text-[11px] font-medium text-amber-100 sm:px-7">
            {t("library.daily.overflow", { count: plan.overflow })}
          </p>
        )}
      </section>

      <section aria-label={t("library.daily.gridAria")}>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold text-atlas-navy">
              {t("library.daily.gridTitle")}
            </h3>
            <p className="text-xs text-slate-500">{t("library.daily.gridHint")}</p>
          </div>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-500">
            {t("library.daily.dayRange")}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {plan.groups.map((group) => (
            <DailyGroupCard key={group.day} group={group} onStudy={onStudyGroup} />
          ))}
        </div>
      </section>
    </div>
  );
}
