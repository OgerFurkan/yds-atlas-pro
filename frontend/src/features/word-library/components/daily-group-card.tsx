import { ArrowUpRight, CircleCheck, Plus, Play } from "lucide-react";
import { Button } from "@/shared/ui/button";
import type { DailyGroup } from "../model/daily-groups";

export function DailyGroupCard({
  group,
  targetSize,
  onOpen,
  onStudy,
}: {
  group: DailyGroup;
  targetSize: number;
  onOpen: (day: number) => void;
  onStudy: (group: DailyGroup) => void;
}) {
  const isEmpty = group.total === 0;
  const isDone = group.total > 0 && group.learned === group.total;
  const percentage = group.total ? Math.round(group.progress * 100) : 0;

  if (isEmpty) {
    return (
      <button
        type="button"
        onClick={() => onOpen(group.day)}
        className="group flex min-h-28 flex-col justify-between gap-4 rounded-2xl border border-dashed border-border bg-card/40 p-4 text-left transition-colors hover:border-[#f27637] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f27637]"
        aria-label={`${group.day}. güne kelime ekle`}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-muted-foreground">GÜN {group.day}</span>
          <Plus size={18} className="text-muted-foreground transition-colors group-hover:text-[#f27637]" />
        </div>
        <span className="text-sm font-semibold text-foreground">Bu güne kelime ekle</span>
      </button>
    );
  }

  return (
    <article className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-sm transition-shadow hover:shadow-md">
      <button
        type="button"
        onClick={() => onOpen(group.day)}
        className="flex w-full flex-col gap-3 px-4 pt-4 pb-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#f27637] sm:px-5"
        aria-label={`${group.day}. günü aç, ${group.total} kelimeyi yönet`}
      >
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-xs font-bold tracking-wider text-muted-foreground">GÜN {group.day}</span>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              isDone ? "bg-emerald-500/10 text-emerald-600" : "bg-[#f27637]/10 text-[#d85b20]"
            }`}
          >
            {isDone ? "Tamamlandı" : `${group.total} / ${targetSize} kelime`}
          </span>
        </div>
        <div className="flex w-full items-end justify-between gap-3">
          <div>
            <strong className="block text-2xl leading-none text-foreground">
              {group.learned}<span className="text-base font-medium text-muted-foreground">/{group.total}</span>
            </strong>
            <span className="mt-1 block text-xs text-muted-foreground">Öğrenilen kelime</span>
          </div>
          <ArrowUpRight size={19} className="text-muted-foreground" />
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${isDone ? "bg-emerald-500" : "bg-[#f27637]"}`}
            style={{ width: `${percentage}%` }}
          />
        </div>
        <p className="w-full truncate text-xs text-muted-foreground">
          {group.words.slice(0, 4).map((word) => word.word).join(" · ")}
          {group.total > 4 ? ` · +${group.total - 4}` : ""}
        </p>
      </button>
      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 sm:px-5">
        <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span className="font-semibold text-orange-600">{group.hard} zor</span>
          <span>·</span><span>{group.review} tekrar</span>
          <span>·</span><span className="text-emerald-600">{group.learned} öğrenilen</span>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={group.playable === 0}
          title={group.playable === 0 ? "Çalışmaya hazır kelime yok" : undefined}
          className="min-h-8 shrink-0 px-3"
          onClick={() => onStudy(group)}
          aria-label={`${group.day}. günün kelimeleriyle çalış`}
        >
          {isDone ? <CircleCheck size={14} /> : <Play size={14} />}
          Çalış
        </Button>
      </div>
    </article>
  );
}
