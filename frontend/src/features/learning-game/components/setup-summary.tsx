import { ArrowRight, CalendarCheck2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import type { GameSession } from "../model/game-session";
import { taskGroupCount } from "../model/game-setup";

export function SetupSummary({
  target,
  candidateCount,
  batch,
  busy,
  saved,
  onStart,
}: {
  target: number;
  candidateCount: number;
  batch: 5 | 10;
  busy: boolean;
  saved: GameSession | null;
  onStart: (short?: boolean) => void;
}) {
  const groups = taskGroupCount(target, candidateCount, batch);
  return (
    <aside
      id="task-summary"
      className="flex min-w-0 flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
    >
      <div className="flex items-center gap-2">
        <CalendarCheck2 size={21} className="text-atlas-orange" />
        <h2 className="text-lg font-semibold text-atlas-navy">Görevinin özeti</h2>
      </div>
      <dl className="space-y-3 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Hedef</dt>
          <dd className="font-semibold text-atlas-navy">{target} kelime</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Hazır kelime</dt>
          <dd className="font-semibold text-atlas-navy">{candidateCount}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Çalışma düzeni</dt>
          <dd className="text-right font-semibold text-atlas-navy">
            {groups} grup · {batch}'li
          </dd>
        </div>
      </dl>
      <div className="space-y-3 border-t pt-5">
        {[
          ["Kelimeleri keşfet", "Kartlar, telaffuz ve çevrilmiş örnekler."],
          ["Öğrendiklerini pekiştir", "Anlam ve cümle tamamlama soruları."],
          [
            "Görevi tamamla",
            "Eşleştir, anlamı hatırla, cümlede kullan. Sonunda öğrenme grupların.",
          ],
        ].map(([title, text], index) => (
          <div key={title} className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-blue-50 text-xs font-bold text-atlas-blue">
              {index + 1}
            </span>
            <div>
              <p className="text-sm font-semibold text-atlas-navy">{title}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{text}</p>
            </div>
          </div>
        ))}
      </div>
      <Button
        id="task-start"
        className="mt-auto w-full whitespace-normal px-3"
        disabled={busy || candidateCount < target}
        onClick={() => onStart()}
      >
        {busy ? "Hazırlanıyor…" : "Günlük göreve başla"}
        <ArrowRight size={17} />
      </Button>
      {candidateCount < target && (
        <div className="rounded-lg bg-orange-50 p-3 text-sm leading-6 text-orange-900">
          Hedefin için {target - candidateCount} hazır kelime daha gerekiyor.
          {candidateCount > 0 && (
            <Button
              variant="link"
              className="h-auto min-h-0 whitespace-normal px-0 py-2 text-left text-sm"
              disabled={busy}
              onClick={() => onStart(true)}
            >
              Mevcut {candidateCount} kelimeyle kısa görev başlat
            </Button>
          )}
        </div>
      )}
      {saved && !saved.saved && (
        <p className="text-xs leading-6 text-slate-500">
          Yeni bir görev başlatırsan yarım kalan görevin yerine kaydedilir.
        </p>
      )}
      <p className="text-xs leading-6 text-slate-400">
        İstediğin zaman ara verebilirsin. İlerlemen bu tarayıcıda saklanır.
      </p>
    </aside>
  );
}
