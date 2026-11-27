import type { WordEntry } from "@yds-atlas/shared";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import type { DailyGroup } from "../model/daily-groups";

export function DayWordPicker({
  open,
  groups,
  words,
  selectedDay,
  total,
  preparing,
  onBulkAssignWordIds,
  onClose,
}: {
  open: boolean;
  groups: DailyGroup[];
  words: WordEntry[];
  selectedDay: number;
  total: number;
  preparing: boolean;
  onBulkAssignWordIds: (wordIds: string[], day: number) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [bulkQuery, setBulkQuery] = useState("");
  const [bulkSelected, setBulkSelected] = useState<string[]>([]);
  const [bulkUnassignedOnly, setBulkUnassignedOnly] = useState(false);
  const assignedDays = useMemo(() => {
    const result = new Map<string, number>();
    for (const group of groups) for (const word of group.words) result.set(word.id, group.day);
    return result;
  }, [groups]);
  const availableWords = useMemo(
    () =>
      words
        .filter((word) => assignedDays.get(word.id) !== selectedDay)
        .sort((a, b) => a.word.localeCompare(b.word)),
    [words, assignedDays, selectedDay],
  );
  const bulkCandidates = availableWords.filter(
    (word) =>
      (!bulkUnassignedOnly || !assignedDays.has(word.id)) &&
      `${word.word} ${word.meanings.join(" ")}`
        .toLocaleLowerCase("tr")
        .includes(bulkQuery.trim().toLocaleLowerCase("tr")),
  );
  const availableSlots = Math.max(0, 40 - total);
  async function addSelectedWords() {
    if (!bulkSelected.length) return;
    const moved = bulkSelected.filter((id) => assignedDays.has(id));
    if (
      moved.length &&
      !window.confirm(t("library.daily.manage.confirmMoveMany", { count: moved.length }))
    )
      return;
    if (await onBulkAssignWordIds(bulkSelected, selectedDay)) {
      setBulkSelected([]);
      onClose();
    }
  }

  if (!open) return null;
  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-muted/40 p-3"
      aria-label={t("library.daily.manage.pickerAria")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {t("library.daily.manage.pickerAria")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("library.daily.manage.pickerSummary", {
              slots: availableSlots,
              selected: bulkSelected.length,
            })}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setBulkSelected([])}
          disabled={preparing || !bulkSelected.length}
        >
          {t("library.daily.manage.clearSelection")}
        </Button>
      </div>
      <input
        type="search"
        aria-label={t("library.daily.manage.searchToAddAria")}
        value={bulkQuery}
        placeholder={t("library.daily.manage.searchPlaceholder")}
        onChange={(event) => setBulkQuery(event.target.value)}
        className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-card px-3 text-sm text-foreground"
      />
      <label className="inline-flex items-center gap-2 text-xs text-foreground">
        <input
          type="checkbox"
          checked={bulkUnassignedOnly}
          onChange={(event) => setBulkUnassignedOnly(event.target.checked)}
        />
        {t("library.daily.manage.unassignedOnly")}
      </label>
      <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-border bg-card p-2">
        {bulkCandidates.slice(0, 150).map((word) => {
          const selected = bulkSelected.includes(word.id);
          return (
            <label
              key={word.id}
              className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-foreground hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={selected}
                disabled={!selected && bulkSelected.length >= availableSlots}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setBulkSelected((current) =>
                    checked ? [...current, word.id] : current.filter((id) => id !== word.id),
                  );
                }}
              />
              <span className="min-w-0 flex-1 break-words">
                {word.word}{" "}
                <span className="text-xs text-muted-foreground">
                  — {word.meanings[0] || t("library.daily.manage.noMeaning")}
                </span>
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {assignedDays.has(word.id)
                  ? t("library.daily.manage.assignedDay", {
                      day: assignedDays.get(word.id),
                    })
                  : t("library.daily.manage.unassigned")}
              </span>
            </label>
          );
        })}
        {!bulkCandidates.length && (
          <p className="p-3 text-sm text-muted-foreground">
            {t("library.daily.manage.noCandidate")}
          </p>
        )}
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={availableSlots === 0 || !bulkCandidates.length}
          onClick={() =>
            setBulkSelected((current) =>
              [...new Set([...current, ...bulkCandidates.map((word) => word.id)])].slice(
                0,
                availableSlots,
              ),
            )
          }
        >
          {t("library.daily.manage.selectVisible")}
        </Button>
        <Button size="sm" onClick={addSelectedWords} disabled={preparing || !bulkSelected.length}>
          {t("library.daily.manage.addSelected", { count: bulkSelected.length })}
        </Button>
      </div>
    </section>
  );
}
