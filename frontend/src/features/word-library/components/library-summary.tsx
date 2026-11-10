import { LibraryBig, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import type { WordCounts } from "../model/word-library-view";

export function LibrarySummary({
  counts,
  onDeleteAll,
}: {
  counts: WordCounts;
  onDeleteAll: () => void;
}) {
  return (
    <section
      className="flex min-h-[84px] flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-slate-200 bg-white px-4 py-3"
      aria-label="Kütüphane özeti"
    >
      <div className="flex items-center gap-3 border-r border-slate-200 pr-5 max-sm:pr-3">
        <span className="grid size-10 place-items-center rounded-lg bg-sky-50 text-atlas-blue">
          <LibraryBig size={23} />
        </span>
        <div>
          <small className="block text-sm font-bold tracking-[.8px] text-slate-400">
            KÜTÜPHANENDE
          </small>
          <strong className="text-lg leading-tight text-atlas-ink">
            {counts.all} <span className="text-xs font-medium text-atlas-muted">kelime</span>
          </strong>
        </div>
      </div>
      <div className="flex flex-1 items-center gap-5 max-sm:order-3 max-sm:w-full max-sm:flex-none max-sm:justify-between max-sm:border-t max-sm:border-slate-200 max-sm:pt-3">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-600">
          <i className="size-1.5 rounded-full bg-atlas-orange" />
          {counts.hard} zorlanılan
        </span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-600">
          <i className="size-1.5 rounded-full bg-amber-500" />
          {counts.review} tekrar
        </span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-600">
          <i className="size-1.5 rounded-full bg-emerald-600" />
          {counts.learned} öğrenilen
        </span>
      </div>
      <Button
        variant="destructive"
        size="sm"
        type="button"
        onClick={onDeleteAll}
        disabled={!counts.all}
      >
        <Trash2 size={15} /> Tümünü sil
      </Button>
    </section>
  );
}
