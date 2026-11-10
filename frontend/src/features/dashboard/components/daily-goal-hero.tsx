import { ArrowRight, CalendarCheck2, Minus, Plus, Settings2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Progress } from "@/shared/ui/progress";
import { AtlasCompanion } from "./atlas-companion";

export function DailyGoalHero({
  goal,
  completed,
  onChange,
  onStart,
}: {
  goal: number;
  completed: number;
  onChange: (step: number) => void;
  onStart: () => void;
}) {
  const [settings, setSettings] = useState(false);
  const percent = Math.min(100, Math.round((completed / goal) * 100));
  return (
    <>
      <section
        aria-labelledby="goal-title"
        className="relative overflow-hidden rounded-2xl border border-orange-200 bg-gradient-to-br from-[#ffc08d] via-[#ffad73] to-[#ffcd9f] p-5 sm:p-8 lg:p-10"
      >
        <div className="grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_minmax(280px,.8fr)] lg:gap-12">
          <div className="relative z-10 min-w-0">
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 text-xs font-bold tracking-wider text-atlas-navy">
                <CalendarCheck2 size={17} /> GÜNLÜK GÖREV
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto min-h-9 bg-white/35 text-atlas-navy hover:bg-white/60 sm:ml-0"
                onClick={() => setSettings(true)}
              >
                <Settings2 size={14} /> Hedefi düzenle
              </Button>
            </div>
            <h2
              id="goal-title"
              className="max-w-xl font-display text-[clamp(30px,3.6vw,48px)] leading-[1.12] text-atlas-navy"
            >
              Bugünün kelimeleri,
              <br />
              <span className="text-white">yarının gücü.</span>
            </h2>
            <p className="mt-4 max-w-lg text-sm leading-7 text-[#634735]">
              {goal} kelimeyi keşfet, anlamlarını pekiştir ve cümle içinde öğren. Günlük görevini
              tamamla, serine bir gün ekle.
            </p>
            <div className="mt-5 max-w-md space-y-2.5">
              <div className="flex justify-between text-sm text-atlas-navy">
                <span>
                  <strong>{Math.min(completed, goal)}</strong> / {goal} kelime tamamlandı
                </span>
                <strong>%{percent}</strong>
              </div>
              <Progress
                value={percent}
                aria-label="Günlük kelime hedefi"
                className="h-2.5 bg-white/55"
              />
            </div>
            <Button
              className="mt-6 w-full bg-atlas-navy text-white hover:bg-[#0c2e46] sm:w-auto"
              disabled={completed >= goal}
              onClick={onStart}
            >
              {completed >= goal ? (
                "Günlük Hedef Tamamlandı"
              ) : (
                <span className="flex items-center gap-2">
                  Hedefe Başla <ArrowRight size={16} />
                </span>
              )}
            </Button>
          </div>
          <AtlasCompanion goal={goal} completed={completed} />
        </div>
      </section>
      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div>
              <DialogTitle>Günlük kelime hedefin</DialogTitle>
              <DialogDescription>
                Her gün kaç kelime çalışmak istersin? Hedefini dilediğinde değiştirebilirsin.
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="space-y-6 p-6">
            <div className="flex items-center justify-center gap-5">
              <Button
                size="icon"
                variant="outline"
                aria-label="Hedefi 10 azalt"
                disabled={goal <= 10}
                onClick={() => onChange(-1)}
              >
                <Minus size={18} />
              </Button>
              <output aria-live="polite" className="min-w-24 text-center">
                <strong className="block text-4xl text-atlas-navy">{goal}</strong>
                <span className="text-sm text-slate-500">kelime / gün</span>
              </output>
              <Button
                size="icon"
                variant="outline"
                aria-label="Hedefi 10 artır"
                disabled={goal >= 100}
                onClick={() => onChange(1)}
              >
                <Plus size={18} />
              </Button>
            </div>
            <p className="text-center text-sm text-slate-500">
              10 ile 100 arasında, 10'ar kelimelik adımlar.
            </p>
            <Button className="w-full" onClick={() => setSettings(false)}>
              Tamam
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
