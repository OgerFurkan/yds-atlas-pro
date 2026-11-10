import { CalendarCheck2, CircleHelp, GraduationCap, Play } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import type { GameSession } from "../model/game-session";

export function SetupIntro({
  saved,
  guideActive,
  onStartGuide,
  onTutorial,
  onResume,
}: {
  saved: GameSession | null;
  guideActive: boolean;
  onStartGuide: () => void;
  onTutorial: () => void;
  onResume: () => void;
}) {
  return (
    <>
      <section
        id="task-intro"
        className="flex flex-wrap items-start justify-between gap-5 rounded-2xl border border-blue-100 bg-white p-5 sm:p-7"
      >
        <div className="flex min-w-0 flex-1 gap-4">
          <span className="hidden size-14 shrink-0 place-items-center rounded-2xl bg-orange-50 text-orange-600 sm:grid">
            <CalendarCheck2 size={29} />
          </span>
          <div>
            <Badge variant="secondary">GÜNLÜK HEDEFİN İÇİN</Badge>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-atlas-navy">Günlük Görev</h1>
            <p className="mt-2 max-w-xl text-sm leading-7 text-slate-500">
              Bugün çalışacağın kelimeleri seç. Kelimeleri küçük gruplarla öğren, ardından genel
              değerlendirmeyi tamamla.
            </p>
          </div>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button variant="outline" onClick={onStartGuide}>
            <CircleHelp size={17} /> Hazırlık rehberi
          </Button>
          <Button variant="secondary" onClick={onTutorial}>
            <GraduationCap size={18} /> Oyunu dene
          </Button>
        </div>
      </section>
      {saved && !saved.saved && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-orange-200 bg-orange-50 p-5">
          <div>
            <strong className="text-atlas-navy">Yarım kalan görevin hazır</strong>
            <p className="mt-1 text-sm text-slate-600">
              {saved.words.length} kelimelik çalışmana kaldığın yerden devam edebilirsin.
            </p>
          </div>
          <Button onClick={onResume}>
            <Play size={16} /> Kaldığım yerden devam et
          </Button>
        </div>
      )}
      {saved?.saved && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm text-emerald-900">
            Son günlük görevin tamamlandı. Öğrenme gruplarını yeniden inceleyebilirsin.
          </p>
          <Button variant="outline" onClick={onResume}>
            Son sonuçlarımı gör
          </Button>
        </div>
      )}
      {guideActive && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl bg-atlas-navy px-4 py-3 text-sm text-white"
        >
          <GraduationCap size={20} /> HAZIRLIK REHBERİ · Deneme alanı, değişikliklerin kaydedilmez.
        </div>
      )}
    </>
  );
}
