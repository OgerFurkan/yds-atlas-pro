import { ArrowRight, CalendarCheck2, Minus, Plus, Settings2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Progress } from "@/shared/ui/progress";
import { AtlasCompanion } from "./atlas-companion";

export function DailyGoalHero({
  goal,
  completed,
  onChange,
  onStart,
}: {
  goal: number;
  completed: number;
  onChange: (step: number) => void;
  onStart: () => void;
}) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(false);
  const percent = Math.min(100, Math.round((completed / goal) * 100));
  return (
    <>
      <section
        aria-labelledby="goal-title"
        className="goal-hero relative overflow-hidden rounded-2xl border border-orange-200 bg-gradient-to-br from-[#ffc08d] via-[#ffad73] to-[#ffcd9f] p-5 sm:p-8 lg:p-10"
      >
        <div className="grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_minmax(280px,.8fr)] lg:gap-12">
          <div className="relative z-10 min-w-0">
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <span className="goal-hero__eyebrow inline-flex items-center gap-2 text-xs font-bold tracking-wider">
                <CalendarCheck2 size={17} /> {t("goal.eyebrow")}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="goal-hero__edit ml-auto min-h-9 bg-white/50 text-atlas-navy hover:bg-white/75 sm:ml-0"
                onClick={() => setSettings(true)}
              >
                <Settings2 size={14} /> {t("goal.edit")}
              </Button>
            </div>
            <h2
              id="goal-title"
              className="goal-hero__title max-w-xl font-display text-[clamp(30px,3.6vw,48px)] leading-[1.12]"
            >
              {t("goal.title")}
              <br />
              <span className="goal-hero__accent">{t("goal.titleSecond")}</span>
            </h2>
            <p className="goal-hero__description mt-4 max-w-lg text-sm leading-7">
              {t("goal.description", { goal })}
            </p>
            <div className="mt-5 max-w-md space-y-2.5">
              <div className="goal-hero__progress flex justify-between text-sm">
                <span>
                  <strong>{Math.min(completed, goal)}</strong> / {goal} {t("goal.completed")}
                </span>
                <strong>{t("goal.percent", { percent })}</strong>
              </div>
              <Progress value={percent} aria-label={t("goal.aria")} className="h-2.5 bg-white/55" />
            </div>
            <Button
              className="goal-hero__start mt-6 w-full text-white sm:w-auto"
              disabled={completed >= goal}
              onClick={onStart}
            >
              {completed >= goal ? (
                t("goal.complete")
              ) : (
                <span className="flex items-center gap-2">
                  {t("goal.start")} <ArrowRight size={16} />
                </span>
              )}
            </Button>
          </div>
          <AtlasCompanion goal={goal} completed={completed} />
        </div>
      </section>
      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div>
              <DialogTitle>{t("goal.dialogTitle")}</DialogTitle>
              <DialogDescription>{t("goal.dialogDescription")}</DialogDescription>
            </div>
          </DialogHeader>
          <div className="space-y-6 p-6">
            <div className="flex items-center justify-center gap-5">
              <Button
                size="icon"
                variant="outline"
                aria-label={t("goal.reduce")}
                disabled={goal <= 10}
                onClick={() => onChange(-1)}
              >
                <Minus size={18} />
              </Button>
              <output aria-live="polite" className="min-w-24 text-center">
                <strong className="block text-4xl text-atlas-navy">{goal}</strong>
                <span className="text-sm text-slate-500">{t("goal.perDay")}</span>
              </output>
              <Button
                size="icon"
                variant="outline"
                aria-label={t("goal.increase")}
                disabled={goal >= 100}
                onClick={() => onChange(1)}
              >
                <Plus size={18} />
              </Button>
            </div>
            <p className="text-center text-sm text-slate-500">{t("goal.range")}</p>
            <Button className="w-full" onClick={() => setSettings(false)}>
              {t("goal.done")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
