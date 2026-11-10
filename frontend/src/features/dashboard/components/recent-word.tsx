import type { WordEntry } from "@yds-atlas/shared";
import { WordStatus } from "@/features/word-library/components/word-status";

export function RecentWord({ word }: { word: WordEntry }) {
  return (
    <div className="flex min-h-14 items-center gap-3 border-t border-slate-100">
      <span className="grid size-[30px] shrink-0 place-items-center rounded-lg bg-orange-50 text-sm font-bold text-orange-800">
        {word.word.charAt(0).toUpperCase()}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <strong className="text-base text-slate-800">{word.word}</strong>
        <span className="truncate text-sm text-slate-400">
          {word.meanings[0] || "Anlam bekliyor"}
        </span>
      </div>
      <WordStatus score={word.score} />
    </div>
  );
}
