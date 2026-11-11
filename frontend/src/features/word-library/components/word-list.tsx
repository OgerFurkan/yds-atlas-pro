import type { WordEntry } from "@yds-atlas/shared";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { WordDetails } from "@/features/word-library/components/word-details";
import { WordStatus } from "@/features/word-library/components/word-status";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { formatWordType } from "../model/word-normalization";

export interface WordListActions {
  onEdit: (word: WordEntry) => void;
  onDelete: (word: WordEntry) => void;
}

interface WordListProps extends WordListActions {
  words: WordEntry[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}

function WordActions({ word, onEdit, onDelete }: WordListActions & { word: WordEntry }) {
  const { t } = useTranslation();
  return (
    <div className="inline-flex items-center justify-end gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        type="button"
        onClick={() => onEdit(word)}
        aria-label={t("library.editWord", { word: word.word })}
        title={t("library.edit")}
      >
        <Pencil size={15} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="text-slate-500 hover:bg-red-50 hover:text-red-700"
        type="button"
        onClick={() => onDelete(word)}
        aria-label={t("library.deleteWord", { word: word.word })}
        title={t("library.delete")}
      >
        <Trash2 size={15} />
      </Button>
    </div>
  );
}

function WordTableRow({
  word,
  selected,
  onToggle,
  onEdit,
  onDelete,
}: WordListActions & {
  word: WordEntry;
  selected: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <tr
      className={`word-table-row border-t border-slate-100 transition-[border-color] hover:bg-slate-50/70 ${selected ? "is-selected" : ""}`}
      data-selected={selected}
    >
      <td className="w-10 pl-4 pr-1">
        <Checkbox
          className="size-4"
          checked={selected}
          onCheckedChange={onToggle}
          aria-label={t("library.selectWord", { word: word.word })}
        />
      </td>
      <td className="px-2.5 py-3 align-middle">
        <div className="flex min-w-[120px] flex-col gap-0.5">
          <strong className="text-base text-slate-800">{word.word}</strong>
          {word.alternatives.length > 0 && (
            <small className="text-sm text-slate-400">{word.alternatives.join(", ")}</small>
          )}
          <WordDetails word={word} />
        </div>
      </td>
      <td className="px-2.5 py-3 align-middle">
        <div className="max-w-[225px] text-sm leading-6 text-slate-600">
          {word.meanings.length ? (
            word.meanings.join(" · ")
          ) : (
            <span className="text-sm italic text-slate-400">{t("library.meaningMissing")}</span>
          )}
          {word.usageNote && (
            <small className="mt-0.5 block text-sm text-slate-400">{word.usageNote}</small>
          )}
        </div>
      </td>
      <td className="px-2.5 py-3 text-sm text-slate-600">
        {formatWordType(word.partOfSpeech) || <span className="text-slate-400">—</span>}
      </td>
      <td className="px-2.5 py-3">
        <span
          className={`inline-grid h-[21px] min-w-[29px] place-items-center rounded border px-1 text-sm font-bold ${word.cefr === "Belirtilmedi" ? "border-slate-200 bg-slate-50 text-slate-400" : "border-sky-100 bg-sky-50 text-sky-800"}`}
        >
          {word.cefr === "Belirtilmedi" ? "—" : word.cefr}
        </span>
      </td>
      <td className="px-2.5 py-3">
        <WordStatus score={word.score} />
      </td>
      <td className="px-2.5 py-3">
        <span className="whitespace-nowrap text-sm font-bold text-slate-700">
          {word.score}
          <small className="text-sm font-medium text-slate-400">/100</small>
        </span>
      </td>
      <td className="px-2.5 py-2">
        <WordActions word={word} onEdit={onEdit} onDelete={onDelete} />
      </td>
    </tr>
  );
}

function WordCard({
  word,
  selected,
  onToggle,
  onEdit,
  onDelete,
}: WordListActions & {
  word: WordEntry;
  selected: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <article
      className={`library-word-card min-w-0 rounded-lg border p-4 shadow-sm transition-[border-color,box-shadow] ${selected ? "is-selected border-atlas-orange" : "border-slate-200 bg-white hover:border-atlas-orange/70"}`}
      data-selected={selected}
    >
      <div className="flex min-w-0 items-center gap-2">
        <label className="grid size-4 shrink-0 place-items-center">
          <Checkbox
            className="size-4"
            checked={selected}
            onCheckedChange={onToggle}
            aria-label={t("library.selectWord", { word: word.word })}
          />
        </label>
        <strong className="min-w-0 flex-1 break-words text-base text-slate-800">{word.word}</strong>
        <span
          className={`inline-grid h-[21px] min-w-[29px] place-items-center rounded border px-1 text-sm font-bold ${word.cefr === "Belirtilmedi" ? "border-slate-200 bg-slate-50 text-slate-400" : "border-sky-100 bg-sky-50 text-sky-800"}`}
        >
          {word.cefr === "Belirtilmedi" ? "—" : word.cefr}
        </span>
        <WordActions word={word} onEdit={onEdit} onDelete={onDelete} />
      </div>
      <p className="ml-6 mt-2 text-sm leading-6 text-slate-600">
        {word.meanings.length ? word.meanings.join(" · ") : t("library.meaningMissingCard")}
      </p>
      {word.usageNote && <p className="ml-6 mt-1 text-sm text-slate-400">{word.usageNote}</p>}
      <div className="ml-6 mt-2 flex items-center gap-3">
        <WordStatus score={word.score} />
        <span className="ml-auto text-sm font-bold text-slate-700">
          {word.score}
          <small className="text-sm font-medium text-slate-400">/100</small>
        </span>
      </div>
      <WordDetails word={word} />
    </article>
  );
}

export function WordList({
  words,
  selectedIds,
  onToggle,
  onToggleAll,
  onEdit,
  onDelete,
}: WordListProps) {
  const { t } = useTranslation();
  const [view, setView] = useState("list");
  const allVisibleSelected =
    words.length > 0 && words.every((word) => selectedIds.includes(word.id));
  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-500">
          <Checkbox
            checked={allVisibleSelected}
            onCheckedChange={onToggleAll}
            aria-label={t("library.allVisible")}
          />{" "}
          {t("library.selectAll")}
        </label>
        <Tabs value={view} onValueChange={setView} className="hidden min-[1100px]:block">
          <TabsList>
            <TabsTrigger value="list">{t("library.listView")}</TabsTrigger>
            <TabsTrigger value="cards">{t("library.cardView")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className={view === "list" ? "hidden overflow-x-auto min-[1100px]:block" : "hidden"}>
        <table className="w-full min-w-[980px] border-collapse text-left">
          <thead>
            <tr className="h-9 bg-slate-50 text-sm font-semibold text-slate-400">
              <th className="w-10 pl-4 pr-1">
                <span className="sr-only">{t("library.selection")}</span>
              </th>
              <th className="px-2.5">{t("library.wordColumn")}</th>
              <th className="px-2.5">{t("library.meaningColumn")}</th>
              <th className="px-2.5">{t("library.typeColumn")}</th>
              <th className="px-2.5">{t("library.level")}</th>
              <th className="px-2.5">{t("library.statusColumn")}</th>
              <th className="px-2.5">{t("library.scoreColumn")}</th>
              <th className="px-2.5">
                <span className="sr-only">{t("library.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {words.map((word) => (
              <WordTableRow
                key={word.id}
                word={word}
                selected={selectedIds.includes(word.id)}
                onToggle={() => onToggle(word.id)}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div
        className={
          view === "cards"
            ? "grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3"
            : "grid gap-3 p-3 sm:grid-cols-2 min-[1100px]:hidden"
        }
      >
        {words.map((word) => (
          <WordCard
            key={word.id}
            word={word}
            selected={selectedIds.includes(word.id)}
            onToggle={() => onToggle(word.id)}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
      <div className="flex min-h-10 items-center justify-between border-t border-slate-100 px-3 text-sm text-slate-400 sm:px-4">
        <span>{t("library.countShown", { count: words.length })}</span>
        <span className="hidden sm:inline">{t("library.scoreHint")}</span>
      </div>
    </>
  );
}
