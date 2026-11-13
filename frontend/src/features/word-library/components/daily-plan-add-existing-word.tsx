import type { WordEntry } from "@yds-atlas/shared";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";

interface DailyPlanAddExistingWordProps {
  wordToAdd: string;
  onWordChange: (wordId: string) => void;
  availableWords: WordEntry[];
  assignedDays: ReadonlyMap<string, number>;
  totalWordsInDay: number;
  onAdd: () => void;
}

/** Existing-word selection. Confirmation and persistence remain in DailyPlanView. */
export function DailyPlanAddExistingWord({
  wordToAdd,
  onWordChange,
  availableWords,
  assignedDays,
  totalWordsInDay,
  onAdd,
}: DailyPlanAddExistingWordProps) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3">
      <label htmlFor="day-word-add" className="mb-2 block text-xs font-semibold text-foreground">
        {t("library.daily.manage.addExisting")}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          id="day-word-add"
          value={wordToAdd}
          onChange={(event) => onWordChange(event.target.value)}
          className="min-h-10 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 text-sm text-foreground"
        >
          <option value="">
            {t("library.daily.manage.chooseWord", { count: availableWords.length })}
          </option>
          {availableWords.map((word) => (
            <option key={word.id} value={word.id}>
              {word.word} — {word.meanings[0] || t("library.daily.manage.noMeaning")}
              {assignedDays.has(word.id)
                ? ` (${t("library.daily.manage.assignedDay", { day: assignedDays.get(word.id) })})`
                : ` (${t("library.daily.manage.unassigned").toLocaleLowerCase()})`}
            </option>
          ))}
        </select>
        <Button size="sm" disabled={!wordToAdd || totalWordsInDay >= 40} onClick={onAdd}>
          <Plus size={15} /> {t("library.daily.manage.addToDay")}
        </Button>
      </div>
      {totalWordsInDay >= 40 && (
        <p className="mt-2 text-xs text-orange-700">{t("library.daily.manage.maxWords")}</p>
      )}
    </div>
  );
}
