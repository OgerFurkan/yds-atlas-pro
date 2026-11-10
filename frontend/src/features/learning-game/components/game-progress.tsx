import { Check } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Progress } from "@/shared/ui/progress";
import { gameProgress } from "../model/game-progress";
import { type GameSession, phaseLabels } from "../model/game-session";

export function GameProgress({ session }: { session: GameSession }) {
  const { groups, final, active, percent } = gameProgress(session);
  return (
    <div id="game-progress" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-atlas-navy">
          {final
            ? "Bütün kelimeler · Genel değerlendirme"
            : `Grup ${session.groupIndex + 1} / ${groups}`}
          <span className="ml-2 font-normal text-slate-500">
            {session.words.length} kelimelik görev
          </span>
        </span>
        <Badge variant="outline">%{percent} tamamlandı</Badge>
      </div>
      <Progress value={percent} aria-label="Oyun ilerlemesi" />
      <ol className="grid grid-cols-4 gap-1.5">
        {["Keşfet", "Anlamı bul", "Bağlamda öğren", "Genel değerlendirme"].map((label, index) => (
          <li
            key={label}
            aria-current={index === active ? "step" : undefined}
            className={cn(
              "flex flex-col items-center gap-2 rounded-lg px-1 py-3 text-center text-[10px] sm:flex-row sm:justify-center sm:text-xs",
              index === active
                ? "bg-atlas-blue-pale font-semibold text-atlas-navy"
                : "text-slate-400",
            )}
          >
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full border",
                index < active
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : index === active
                    ? "border-atlas-navy bg-atlas-navy text-white"
                    : "border-slate-200",
              )}
            >
              {index < active ? <Check size={13} /> : index + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>
      {final && session.version === 3 && (
        <ol
          className="flex flex-wrap justify-center gap-2 text-xs"
          aria-label="Genel değerlendirme adımları"
        >
          {["final-matching", "final-meaning", "final-context"].map((phase, index) => (
            <li
              key={phase}
              aria-current={session.phase === phase ? "step" : undefined}
              className={cn(
                "rounded-full px-3 py-1.5",
                session.phase === phase
                  ? "bg-atlas-navy font-semibold text-white"
                  : "bg-white text-slate-500",
              )}
            >
              {index + 1}.{" "}
              {index === 0 ? "Eşleştir" : index === 1 ? "Anlamı hatırla" : "Cümlede kullan"}
            </li>
          ))}
        </ol>
      )}
      <p className="sr-only">{phaseLabels[session.phase]}</p>
    </div>
  );
}
