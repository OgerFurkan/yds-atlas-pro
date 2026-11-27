import { getWordGroup, type WordEntry } from "@yds-atlas/shared";
import { ArrowRightLeft, Pencil, Trash2, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { type DailyGroup, isDayStudyReady } from "../model/daily-groups";

export function DayWordList({
  words,
  group,
  groups,
  preparing,
  onAssignWord,
  onEditWord,
  onRemoveFromDay,
  onDeleteWord,
}: {
  words: WordEntry[];
  group: DailyGroup;
  groups: DailyGroup[];
  preparing: boolean;
  onAssignWord: (id: string, day: number) => void;
  onEditWord: (word: WordEntry) => void;
  onRemoveFromDay: (id: string, day: number) => void;
  onDeleteWord: (word: WordEntry) => void;
}) {
  const { t, i18n } = useTranslation();
  const selectedDay = group.day;
  return (
    <div className="overflow-hidden rounded-xl border border-border/75 bg-card shadow-sm">
      {words.map((word) => (
        <article
          key={word.id}
          className="group/word relative border-b border-border/65 bg-card px-4 py-3 transition-colors last:border-b-0 hover:bg-muted/40 focus-within:bg-muted/40 sm:px-5"
        >
          <div className="grid min-w-0 gap-2.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-5">
            <div className="min-w-0">
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
                <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground/85">
                  {word.examples[0].sentence}
                </p>
              )}
              {getWordGroup(word.score) !== "learned" && !isDayStudyReady(word) && (
                <span className="mt-1 inline-block text-[11px] font-medium text-muted-foreground">
                  {t("library.daily.manage.notReady")}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <div className="inline-flex min-h-10 min-w-[152px] items-center gap-1.5 rounded-xl border border-border/75 bg-card px-2.5 shadow-sm transition-colors hover:border-ring/50 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15">
                <ArrowRightLeft
                  size={15}
                  className="shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <label htmlFor={`move-${word.id}`} className="sr-only">
                  {t("library.daily.manage.moveToDay")}
                </label>
                <Select
                  value={String(selectedDay)}
                  disabled={
                    preparing ||
                    !groups.some((group) => group.day !== selectedDay && group.total < 40)
                  }
                  onValueChange={(value) => {
                    const target = Number(value);
                    if (target >= 1 && target !== selectedDay) onAssignWord(word.id, target);
                  }}
                >
                  <SelectTrigger
                    id={`move-${word.id}`}
                    aria-label={t("library.daily.manage.moveToDay")}
                    className="h-9 min-w-0 flex-1 border-0 bg-transparent px-1 text-xs font-semibold text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-foreground focus-visible:ring-0"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent
                    align="start"
                    className="z-[150] min-w-[174px] border-border bg-popover text-popover-foreground shadow-xl"
                  >
                    <SelectItem
                      value={String(selectedDay)}
                      disabled
                      aria-selected="true"
                      className="text-foreground data-[state=checked]:text-foreground [&>span:first-child]:text-current"
                    >
                      {i18n.language.startsWith("tr")
                        ? `${selectedDay}. Gün`
                        : t("library.daily.manage.assignedDay", { day: selectedDay })}
                    </SelectItem>
                    {groups
                      .filter((group) => group.day !== selectedDay && group.total < 40)
                      .map((group) => (
                        <SelectItem
                          key={group.day}
                          value={String(group.day)}
                          aria-selected="false"
                          className="text-foreground focus:bg-muted data-[highlighted]:bg-muted data-[highlighted]:outline-2 data-[highlighted]:outline-solid data-[highlighted]:-outline-offset-2 data-[highlighted]:outline-foreground"
                        >
                          {i18n.language.startsWith("tr")
                            ? `${group.day}. Gün`
                            : t("library.daily.manage.assignedDay", { day: group.day })}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border/55 bg-card p-0.5">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-9 rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
                  title={t("library.daily.manage.editWord", { word: word.word })}
                  aria-label={t("library.daily.manage.editWord", { word: word.word })}
                  disabled={preparing}
                  onClick={() => onEditWord(word)}
                >
                  <Pencil size={16} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-9 rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
                  title={t("library.daily.manage.removeWordTitle")}
                  aria-label={t("library.daily.manage.removeWord", { word: word.word })}
                  disabled={preparing}
                  onClick={() => onRemoveFromDay(word.id, selectedDay)}
                >
                  <XCircle size={16} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-9 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title={t("library.daily.manage.deleteWordTitle")}
                  aria-label={t("library.daily.manage.deleteWord", { word: word.word })}
                  disabled={preparing}
                  onClick={() => onDeleteWord(word)}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            </div>
          </div>
        </article>
      ))}
      {group.total === 0 && (
        <div className="rounded-xl border border-dashed border-border p-6 text-center">
          <p className="font-semibold text-foreground">{t("library.daily.manage.emptyDayTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("library.daily.manage.emptyDayHint")}
          </p>
        </div>
      )}
      {group.total > 0 && words.length === 0 && (
        <p className="rounded-lg border border-border p-5 text-center text-sm text-muted-foreground">
          {t("library.daily.manage.noSearchResults")}
        </p>
      )}
    </div>
  );
}
