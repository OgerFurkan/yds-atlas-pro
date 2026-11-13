import type { DailyPlan } from "@/features/word-library/model/daily-groups";
import { dailyGroupSizes } from "@/features/word-library/model/daily-groups";
import { CalendarDays, Check, CircleHelp, Clock3, Layers3 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface DailyPlanHeroProps {
  plan: DailyPlan;
  groupSize: number;
  onGroupSizeChange: (size: number) => void;
  onBulkAdd: () => void;
  onStartTour: () => void;
}

/** Read-only overview and target controls. Assignment logic stays with DailyPlanView. */
export function DailyPlanHero({
  plan,
  groupSize,
  onGroupSizeChange,
  onBulkAdd,
  onStartTour,
}: DailyPlanHeroProps) {
  const { t } = useTranslation();
  const percent = plan.totalWords ? Math.round((plan.learned / plan.totalWords) * 100) : 0;
  return (
    <section
      id="daily-plan-hero"
      data-testid="daily-plan-hero"
      className="overflow-hidden rounded-2xl border border-[#28658b] bg-gradient-to-br from-[#103b58] via-[#164c6c] to-[#1b7095] text-white shadow-sm"
    >
      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-bold tracking-widest text-white">
              <CalendarDays size={14} /> {t("library.daily.manage.heroBadge")}
            </span>
            <button
              type="button"
              onClick={onStartTour}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 text-xs font-semibold text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white"
              aria-label={t("library.daily.manage.tourStart")}
            >
              <CircleHelp size={15} /> {t("library.daily.manage.tourStart")}
            </button>
            <button
              id="daily-plan-bulk-add"
              type="button"
              onClick={onBulkAdd}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-white/25 px-3 text-xs font-semibold text-white hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
            >
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
              <span>
                {t("library.daily.manage.learnedProgress", {
                  learned: plan.learned,
                  total: plan.totalWords,
                })}
              </span>
              <span>%{percent}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/25">
              <div
                className="h-full rounded-full bg-[#ff9b62] transition-[width] duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-white">
            <span className="inline-flex items-center gap-1.5">
              <Layers3 size={15} /> {plan.totalWords} {t("library.daily.manage.plannedShort")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock3 size={15} /> {plan.activeDays} {t("library.daily.manage.activeShort")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Check size={15} /> {plan.completedDays} {t("library.daily.manage.completedShort")}
            </span>
          </div>
        </div>
        <div className="flex min-w-0 items-center justify-end">
          <div
            id="daily-plan-target-selector"
            className="w-full min-w-0 rounded-2xl border border-white/25 bg-[#0a314c]/70 p-4 shadow-[0_15px_35px_rgba(0,15,32,0.16)]"
          >
            <div className="mb-3 flex items-center gap-3 border-b border-white/15 pb-3">
              <span className="grid size-16 shrink-0 place-items-center rounded-xl bg-white/10 p-1.5">
                <img
                  src="/brand/atlas-mascot.png"
                  alt="Atlas"
                  draggable={false}
                  className="h-full w-full select-none object-contain drop-shadow-md"
                />
              </span>
              <div className="min-w-0">
                <strong className="block text-xs font-bold text-white">
                  {t("library.daily.manage.atlasTipTitle")}
                </strong>
                <p className="mt-1 text-[11px] leading-relaxed text-[#e0f1f9]">
                  {t("library.daily.manage.atlasTip")}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-white">
                {t("library.daily.manage.dailyTarget")}
              </p>
              <strong className="text-2xl text-white">{groupSize}</strong>
            </div>
            <div
              role="group"
              aria-label={t("library.daily.manage.dailyTarget")}
              className="mt-3 grid grid-cols-4 gap-1 rounded-xl bg-[#082a43] p-1"
            >
              {dailyGroupSizes.map((size) => (
                <button
                  key={size}
                  type="button"
                  aria-pressed={groupSize === size}
                  className={`rounded-lg px-2 py-2 text-sm font-semibold transition-colors ${groupSize === size ? "bg-[#ffffff] text-[#123b59] shadow-sm" : "text-white hover:bg-white/15"}`}
                  onClick={() => onGroupSizeChange(size)}
                >
                  {size}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-[#e0f1f9]">
              {t("library.daily.manage.targetHint")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
