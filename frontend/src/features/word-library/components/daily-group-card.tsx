import { CircleCheck, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import type { DailyGroup } from "../model/daily-groups";

function useGroupStatus(group: DailyGroup) {
  const { t } = useTranslation();
  if (!group.total)
    return { label: t("library.daily.statusEmpty"), tone: "bg-slate-100 text-slate-500" };
  if (group.learned === group.total)
    return { label: t("library.daily.statusDone"), tone: "bg-emerald-50 text-emerald-700" };
  if (group.learned > 0)
    return { label: t("library.daily.statusProgress"), tone: "bg-amber-50 text-amber-700" };
  return { label: t("library.daily.statusNew"), tone: "bg-sky-50 text-atlas-blue" };
}

export function DailyGroupCard({
  group,
  onStudy,
}: {
  group: DailyGroup;
  onStudy: (group: DailyGroup) => void;
}) {
  const { t } = useTranslation();
  const status = useGroupStatus(group);

  if (!group.total)
    return (
      <article className="flex min-h-44 flex-col rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[10px] font-bold tracking-[.14em] text-slate-400">
              {t("library.daily.dayLabel")}
            </span>
            <span className="text-lg leading-none font-bold text-slate-400">{group.day}</span>
          </div>
          <span className={`rounded-md px-2 py-1 text-[10px] font-bold ${status.tone}`}>
            {status.label}
          </span>
        </div>
        <p className="mt-auto text-[11px] leading-5 text-slate-400">
          {t("library.daily.emptyHint")}
        </p>
      </article>
    );

  const completed = group.learned === group.total;
  const canStudy = group.playable > 0;
  const buttonLabel = completed
    ? t("library.daily.completed")
    : canStudy
      ? t("library.daily.study")
      : t("library.daily.noPlayable");

  return (
    <article className="group flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-atlas-orange/60 hover:shadow-md">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[10px] font-bold tracking-[.14em] text-slate-400">
            {t("library.daily.dayLabel")}
          </span>
          <span className="text-lg leading-none font-bold text-atlas-navy">{group.day}</span>
        </div>
        <span className={`rounded-md px-2 py-1 text-[10px] font-bold ${status.tone}`}>
          {status.label}
        </span>
      </div>

      <div className="mt-4 flex items-end justify-between gap-2">
        <div>
          <p className="text-2xl leading-none font-bold text-atlas-ink">
            <span className={completed ? "text-emerald-600" : "text-atlas-navy"}>
              {group.learned}
            </span>
            <span className="text-base font-semibold text-slate-400">/{group.total}</span>
          </p>
          <p className="mt-1 text-[11px] font-medium text-slate-400">
            {t("library.daily.learnedLabel")}
          </p>
        </div>
        <p className="text-[11px] font-semibold text-slate-500">
          {t("library.daily.wordCount", { count: group.total })}
        </p>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${completed ? "bg-emerald-500" : "bg-atlas-orange"}`}
          style={{ width: `${Math.round(group.progress * 100)}%` }}
        />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
        <div className="rounded-lg bg-orange-50 px-1 py-2">
          <strong className="block text-sm leading-none text-orange-800">{group.hard}</strong>
          <span className="mt-1 block text-[10px] font-medium text-orange-700/80">
            {t("library.daily.hard")}
          </span>
        </div>
        <div className="rounded-lg bg-amber-50 px-1 py-2">
          <strong className="block text-sm leading-none text-amber-800">{group.review}</strong>
          <span className="mt-1 block text-[10px] font-medium text-amber-700/80">
            {t("library.daily.review")}
          </span>
        </div>
        <div className="rounded-lg bg-emerald-50 px-1 py-2">
          <strong className="block text-sm leading-none text-emerald-800">{group.learned}</strong>
          <span className="mt-1 block text-[10px] font-medium text-emerald-700/80">
            {t("library.daily.learned")}
          </span>
        </div>
      </div>

      <p className="mt-3 truncate text-[11px] text-slate-500">
        {group.words
          .slice(0, 3)
          .map((word) => word.word)
          .join(", ")}
        {group.words.length > 3 && (
          <span className="font-semibold text-slate-400">
            {" "}
            {t("library.daily.previewMore", { count: group.words.length - 3 })}
          </span>
        )}
      </p>

      <Button
        className="mt-3 w-full"
        size="sm"
        type="button"
        disabled={!canStudy}
        title={!canStudy && !completed ? t("library.daily.noPlayableHint") : undefined}
        aria-label={t("library.daily.studyAria", { day: group.day })}
        onClick={() => onStudy(group)}
      >
        {completed ? <CircleCheck size={15} /> : <Play size={15} />}
        {buttonLabel}
      </Button>
      {!completed && canStudy && group.playable < group.total && (
        <p className="mt-2 text-center text-[10px] text-slate-400">
          {t("library.daily.readyCount", { count: group.playable })}
        </p>
      )}
    </article>
  );
}
