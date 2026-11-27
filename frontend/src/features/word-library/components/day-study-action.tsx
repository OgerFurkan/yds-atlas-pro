import { Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/utils";
import { Button, type ButtonProps } from "@/shared/ui/button";
import type { DailyGroup } from "../model/daily-groups";
import type { DayStudyState } from "../model/day-study-state";

export function DayStudyButton({
  state,
  day,
  describe,
  className,
  ...props
}: ButtonProps & { state: DayStudyState; day?: number; describe: string }) {
  const { t } = useTranslation();
  const prepare = state === "prepare";
  return (
    <Button
      {...props}
      className={cn(
        "bg-[#ab451b] text-white hover:bg-[#923413] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-foreground focus-visible:ring-0",
        className,
      )}
      disabled={props.disabled || (!prepare && state !== "ready" && state !== "partial")}
      aria-label={
        day === undefined
          ? undefined
          : t(
              prepare
                ? "library.daily.manage.prepareCardAria"
                : "library.daily.manage.studyCardAria",
              {
                day,
              },
            )
      }
      aria-describedby={state === "ready" || state === "empty" ? undefined : describe}
    >
      <Play size={15} aria-hidden="true" />
      {t(prepare ? "library.daily.manage.prepareStudy" : "library.daily.manage.study")}
    </Button>
  );
}

export function DayStudyStatus({
  group,
  state,
  id,
  issue,
  onComplete,
  onRecheck,
}: {
  group: DailyGroup;
  state: DayStudyState;
  id: string;
  issue?: string;
  onComplete?: () => void;
  onRecheck?: () => void;
}) {
  const { t } = useTranslation();
  if (state === "empty" || state === "ready") return null;
  const canEdit = state !== "learned" && state !== "prepare";
  const canRecheck = ["offline", "cooldown", "not-configured"].includes(state);
  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-foreground">
      <p id={id} role="status">
        <DayStudyStatusText group={group} state={state} issue={issue} />
      </p>
      {canEdit && (onComplete || (canRecheck && onRecheck)) && (
        <div className="flex flex-wrap gap-x-3">
          {onComplete && (
            <Button variant="link" size="sm" className="px-0" onClick={onComplete}>
              {t("library.daily.manage.completeDetails")}
            </Button>
          )}
          {canRecheck && onRecheck && (
            <Button variant="link" size="sm" className="px-0" onClick={onRecheck}>
              {t("settings.ai.recheck")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function DayStudyStatusText({
  group,
  state,
  issue,
}: {
  group: DailyGroup;
  state: DayStudyState;
  issue?: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      {t(`library.daily.manage.study_state_${state}`, {
        day: group.day,
        ready: group.playable,
        count: group.total - group.learned - group.playable,
      })}
      {(state === "offline" || state === "cooldown") && issue && (
        <span className="block">{issue}</span>
      )}
    </>
  );
}
