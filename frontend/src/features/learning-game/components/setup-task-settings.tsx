import { Check, Layers } from "lucide-react";
import { useTranslation } from "react-i18next";
import { dailyGoalOptions } from "@/features/dashboard/model/daily-progress";
import { Button } from "@/shared/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

export function SetupTaskSettings({
  target,
  onTargetChange,
  batch,
  onBatchChange,
}: {
  target: number;
  onTargetChange: (target: number) => void;
  batch: 5 | 10;
  onBatchChange: (batch: 5 | 10) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="mt-auto border-t pt-6">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid size-8 place-items-center rounded-full bg-orange-50 text-sm font-bold text-orange-700">
          2
        </span>
        <h2 className="text-lg font-semibold text-atlas-navy">{t("setup.configure")}</h2>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div id="task-target" className="min-w-0">
          <label
            htmlFor="task-target-select"
            className="mb-2 block text-sm font-semibold text-slate-700"
          >
            {t("setup.target")}
          </label>
          <Select value={String(target)} onValueChange={(value) => onTargetChange(Number(value))}>
            <SelectTrigger
              id="task-target-select"
              className="h-11 w-full"
              aria-label="Oturum hedefi"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {dailyGoalOptions.map((count) => (
                <SelectItem value={String(count)} key={count}>
                  {count} {t("library.word", { count })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-2 text-xs leading-5 text-slate-500">{t("setup.targetHint")}</p>
        </div>
        <fieldset id="task-batch" className="min-w-0">
          <legend className="mb-2 text-sm font-semibold text-slate-700">
            {t("setup.question")}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {([5, 10] as const).map((count) => (
              <Button
                id={count === 10 ? "task-batch-10" : "task-batch-5"}
                className="min-w-0 px-2"
                key={count}
                aria-pressed={batch === count}
                variant={batch === count ? "default" : "outline"}
                onClick={() => onBatchChange(count)}
              >
                {batch === count ? <Check size={16} /> : <Layers size={16} />}
                {t("setup.batches", { count })}
              </Button>
            ))}
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">{t("setup.batchHint")}</p>
        </fieldset>
      </div>
    </section>
  );
}
