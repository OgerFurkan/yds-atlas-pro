import type { WordEntry } from "@yds-atlas/shared";
import type { DailyGroup, DailyPlan } from "@/features/word-library/model/daily-groups";
import { ArrowRightLeft, Pencil, Trash2, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";

interface DailyPlanWordCardProps {
  word: WordEntry;
  group: DailyGroup;
  groups: DailyPlan["groups"];
  selectedDay: number;
  onEditWord: (word: WordEntry) => void;
  onDeleteWord: (word: WordEntry) => void;
  onRemoveFromDay: (wordId: string, day: number) => void;
  onAssignWord: (wordId: string, day: number) => void;
}

/** A single daily word row with accessible edit, remove, delete, and move controls. */
export function DailyPlanWordCard({
  word,
  group,
  groups,
  selectedDay,
  onEditWord,
  onDeleteWord,
  onRemoveFromDay,
  onAssignWord,
}: DailyPlanWordCardProps) {
  const { t } = useTranslation();
  return (
    <article className="rounded-xl border border-border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="break-words text-base text-foreground">{word.word}</strong>
            <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
              {word.cefr}
            </span>
            <span className="text-xs text-muted-foreground">
              {word.partOfSpeech || t("library.daily.manage.unspecifiedType")}
            </span>
          </div>
          <p className="mt-1 break-words text-sm text-muted-foreground">
            {word.meanings.length
              ? word.meanings.join(" · ")
              : t("library.daily.manage.meaningMissing")}
          </p>
          {word.examples[0] && (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {word.examples[0].sentence}
            </p>
          )}
          {!group.playableWords.some((ready) => ready.id === word.id) && (
            <span className="mt-1 inline-block text-[11px] font-medium text-orange-600">
              {t("library.daily.manage.notReady")}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            title={t("library.daily.manage.editWord", { word: word.word })}
            aria-label={t("library.daily.manage.editWord", { word: word.word })}
            onClick={() => onEditWord(word)}
          >
            <Pencil size={16} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            title={t("library.daily.manage.removeWordTitle")}
            aria-label={t("library.daily.manage.removeWord", { word: word.word })}
            onClick={() => onRemoveFromDay(word.id, selectedDay)}
          >
            <XCircle size={16} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            title={t("library.daily.manage.deleteWordTitle")}
            aria-label={t("library.daily.manage.deleteWord", { word: word.word })}
            onClick={() => onDeleteWord(word)}
          >
            <Trash2 size={16} className="text-red-600" />
          </Button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-2">
        <ArrowRightLeft size={14} className="text-muted-foreground" />
        <label htmlFor={`move-${word.id}`} className="text-xs text-muted-foreground">
          {t("library.daily.manage.moveToDay")}
        </label>
        <select
          id={`move-${word.id}`}
          value={selectedDay}
          onChange={(event) => onAssignWord(word.id, Number(event.target.value))}
          className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground"
        >
          {groups
            .filter((group) => group.day === selectedDay || group.total < 40)
            .map((group) => (
              <option key={group.day} value={group.day}>
                {t("library.daily.manage.assignedDay", { day: group.day })}
              </option>
            ))}
        </select>
      </div>
    </article>
  );
}
