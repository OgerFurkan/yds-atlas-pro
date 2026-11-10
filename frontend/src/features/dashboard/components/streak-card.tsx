import { Check, Flame, Trophy } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { getStreak } from "../model/streak";

export function StreakCard({ now }: { now: Date }) {
  const streak = getStreak(now);
  return (
    <aside
      className="relative min-w-0 overflow-hidden rounded-2xl border border-orange-100 bg-white p-5 sm:p-6"
      aria-label="Günlük çalışma serisi"
    >
      <div className="flex items-center justify-between">
        <span className="grid size-12 place-items-center rounded-2xl bg-orange-50 text-orange-500">
          <Flame size={29} fill="currentColor" />
        </span>
        <span className="flex items-center gap-1.5 rounded-full bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-500">
          <Trophy size={14} /> Rekor: {streak.longest} gün
        </span>
      </div>
      <p className="mt-5 text-3xl font-bold text-atlas-navy">
        {streak.current}
        <span className="ml-2 text-lg font-semibold">günlük seri</span>
      </p>
      <p className="mt-2 min-h-12 text-sm leading-6 text-slate-500">
        {streak.todayCompleted
          ? "Bugünkü hedef tamam! Serini yarın da devam ettir."
          : streak.current
            ? "Serin devam ediyor. Bugünkü hedefini bitir, bir gün daha ekle."
            : "Bugünkü hedefini tamamla, ilk alevini yak."}
      </p>
      <div className="mt-5 grid grid-cols-7 gap-1.5">
        {streak.week.map((day) => (
          <div key={day.date} className="space-y-2 text-center">
            <span
              className={cn(
                "text-xs",
                day.today ? "font-bold text-atlas-orange-dark" : "text-slate-400",
              )}
            >
              {day.label}
            </span>
            <span
              role="img"
              title={`${day.date}${day.completed ? " · Hedef tamamlandı" : ""}`}
              aria-label={`${day.label}${day.today ? ", bugün" : ""}: ${day.completed ? "tamamlandı" : "henüz tamamlanmadı"}`}
              className={cn(
                "mx-auto grid aspect-square w-full max-w-9 place-items-center rounded-full border",
                day.completed
                  ? "border-orange-400 bg-orange-500 text-white"
                  : day.today
                    ? "border-dashed border-orange-400 bg-orange-50 text-orange-400"
                    : "border-slate-100 bg-slate-50 text-slate-300",
                day.future && "opacity-60",
              )}
            >
              {day.completed ? (
                <Check size={17} strokeWidth={3} />
              ) : day.today ? (
                <Flame size={16} />
              ) : (
                <span className="size-1.5 rounded-full bg-current" />
              )}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs leading-5 text-slate-400">
        Günlük hedefini tamamladığın her gün serine eklenir.
      </p>
    </aside>
  );
}
