import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import type { useDayStudy } from "../hooks/use-day-study";
import type { DailyGroup, DailyPlan } from "../model/daily-groups";
export function DayStudyFeedback({
  study,
  plan,
  studyBlocked,
  selectedDay,
  editFirstIncomplete,
  openDay,
  onStudyGroup,
}: {
  study: ReturnType<typeof useDayStudy>;
  plan: DailyPlan;
  studyBlocked: boolean;
  selectedDay: number | null;
  editFirstIncomplete: (group: DailyGroup) => void;
  openDay: (day: number) => void;
  onStudyGroup: (group: DailyGroup) => void;
}) {
  const { t } = useTranslation();
  const { preparation, preparing, cancelStudy, requestStudy } = study;
  return (
    preparation && (
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
        {preparation.issue && (
          <p role="alert" className="whitespace-pre-line">
            {preparation.issue}
          </p>
        )}
        {preparing ? (
          <Button variant="outline" size="sm" onClick={cancelStudy}>
            {t("library.daily.manage.cancelPreparation")}
          </Button>
        ) : preparation.phase !== "done" ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={studyBlocked}
              onClick={() =>
                void requestStudy(plan.groups[preparation.day - 1], true, preparation.contentOnly)
              }
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
        ) : null}
      </div>
    )
  );
}
