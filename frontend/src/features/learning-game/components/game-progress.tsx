import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Progress } from "@/shared/ui/progress";
import { gameProgress } from "../model/game-progress";
import { type GameSession, phaseLabels } from "../model/game-session";

export function GameProgress({ session }: { session: GameSession }) {
  const { t } = useTranslation();
  const { groups, final, active, percent } = gameProgress(session);
  const steps = t("game.progressSteps", { returnObjects: true }) as string[];
  const labels = [steps[0], ...(session.groupMatching ? [steps[1]] : []), ...steps.slice(2)];
  return (
    <div id="game-progress" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-atlas-navy">
          {final
            ? t("game.allWordsAssessment")
            : t("game.group", { current: session.groupIndex + 1, count: groups })}
          <span className="ml-2 font-normal text-slate-500">
            {t("game.taskCount", { count: session.words.length })}
          </span>
        </span>
        <Badge variant="outline">{t("game.percent", { percent })}</Badge>
      </div>
      <Progress value={percent} aria-label={t("game.progressAria")} />
      <ol className={cn("grid gap-1.5", session.groupMatching ? "grid-cols-5" : "grid-cols-4")}>
        {labels.map((label, index) => (
          <li
            key={label}
            aria-current={index === active ? "step" : undefined}
            className={cn(
              "flex flex-col items-center gap-2 rounded-lg px-1 py-3 text-center text-[10px] sm:flex-row sm:justify-center sm:text-xs",
              index === active
                ? "bg-atlas-blue-pale font-semibold text-atlas-navy"
                : "text-slate-400",
            )}
          >
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full border",
                index < active
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : index === active
                    ? "border-atlas-navy bg-atlas-navy text-white"
                    : "border-slate-200",
              )}
            >
              {index < active ? <Check size={13} /> : index + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>
      {final && session.version === 3 && (
        <ol
          className="flex flex-wrap justify-center gap-2 text-xs"
          aria-label={t("game.finalAria")}
        >
          {["final-matching", "final-meaning", "final-context"].map((phase, index) => (
            <li
              key={phase}
              aria-current={session.phase === phase ? "step" : undefined}
              className={cn(
                "rounded-full px-3 py-1.5",
                session.phase === phase
                  ? "bg-atlas-navy font-semibold text-white"
                  : "bg-white text-slate-500",
              )}
            >
              {index + 1}. {(t("game.finalSteps", { returnObjects: true }) as string[])[index]}
            </li>
          ))}
        </ol>
      )}
      <p className="sr-only">
        {t(`game.phases.${session.phase}`, { defaultValue: phaseLabels[session.phase] })}
      </p>
    </div>
  );
}
