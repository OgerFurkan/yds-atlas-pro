import { CalendarDays, Check, CircleHelp, Clock3, Layers3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type DailyPlan, dailyGroupSizes } from "../model/daily-groups";

export function DailyPlanHero({
  plan,
  groupSize,
  onGroupSizeChange,
  onBulkAdd,
  onGuide,
}: {
  plan: DailyPlan;
  groupSize: number;
  onGroupSizeChange: (size: number) => void;
  onBulkAdd: () => void;
  onGuide: () => void;
}) {
  const { t } = useTranslation();
  const percent = plan.totalWords ? Math.round((plan.learned / plan.totalWords) * 100) : 0;
  return (
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
              onClick={onGuide}
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
  );
}
