import { getWordGroup } from "@yds-atlas/shared";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Compass,
  LoaderCircle,
  RotateCw,
  Trophy,
} from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { resultScore } from "../model/game-engine";
import type { GameSession } from "../model/game-session";

export function GameResults({
  session,
  saving,
  error,
  onSave,
  onBack,
}: {
  session: GameSession;
  saving: boolean;
  error: string;
  onSave: () => void;
  onBack: () => void;
}) {
  const groups = [
    {
      id: "learned",
      label: "Öğrenilen kelimeler",
      description: "Bu kelimeler artık daha tanıdık.",
      icon: CheckCircle2,
      tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
    },
    {
      id: "review",
      label: "Tekrar gerektirenler",
      description: "Biraz daha çalışmayla pekişecek.",
      icon: RotateCw,
      tone: "border-blue-200 bg-blue-50 text-blue-800",
    },
    {
      id: "hard",
      label: "Birlikte çalışmaya devam",
      description: "Bu kelimeler için yeni pratikler iyi gelecek.",
      icon: Compass,
      tone: "border-orange-200 bg-orange-50 text-orange-800",
    },
  ];
  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <div className="rounded-2xl border bg-white p-6 text-center sm:p-9">
        <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-orange-50 text-orange-500">
          <Trophy size={34} />
        </span>
        <Badge variant="secondary" className="mt-5">
          {session.tutorial ? "OYUN REHBERİ TAMAMLANDI" : "GÜNLÜK GÖREV TAMAMLANDI"}
        </Badge>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-atlas-navy">
          {session.tutorial ? "Artık göreve hazırsın." : "Bugün kendine bir adım kattın."}
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-slate-500">
          {session.words.length} kelimeyi çalıştın; genel değerlendirmede {session.finalTotal}{" "}
          adımın {session.finalCorrect} tanesini ilk denemede doğru tamamladın.
        </p>
        {session.tutorial ? (
          <p className="mt-3 text-sm leading-7 text-slate-500">
            Kartları, soruları ve geri bildirimleri deneyimledin. Bu deneme kütüphaneni ve günlük
            serini değiştirmedi.
          </p>
        ) : (
          <p
            role="status"
            className="mt-4 flex items-center justify-center gap-2 text-sm text-atlas-blue"
          >
            {saving ? (
              <>
                <LoaderCircle className="animate-spin" size={17} /> Sonuçların kaydediliyor…
              </>
            ) : session.saved ? (
              <>
                <CheckCircle2 size={18} /> Kelime grupların ve günlük ilerlemen güncellendi.
              </>
            ) : (
              "Sonuçların kaydedilmeyi bekliyor."
            )}
          </p>
        )}
      </div>
      {!session.tutorial && (
        <div className="grid items-start gap-4 md:grid-cols-3">
          {groups.map((group) => {
            const words = session.words.filter(
              (word) => getWordGroup(resultScore(session, word)) === group.id,
            );
            return (
              <article key={group.id} className="overflow-hidden rounded-xl border bg-white">
                <div className={`border-b p-4 ${group.tone}`}>
                  <div className="flex items-center justify-between">
                    <group.icon size={23} />
                    <strong className="text-2xl">{words.length}</strong>
                  </div>
                  <h2 className="mt-3 text-sm font-semibold">{group.label}</h2>
                  <p className="mt-1 text-xs leading-6 opacity-80">{group.description}</p>
                </div>
                <ul className="max-h-64 divide-y overflow-y-auto px-4">
                  {words.length ? (
                    words.map((word) => (
                      <li key={word.id} className="py-3">
                        <strong className="text-sm text-atlas-navy">{word.word}</strong>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          {word.meanings.join(", ")}
                        </p>
                      </li>
                    ))
                  ) : (
                    <li className="py-5 text-sm text-slate-400">Bu grupta kelime yok.</li>
                  )}
                </ul>
              </article>
            );
          })}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-7 text-red-800"
        >
          {error}
          <Button variant="outline" className="mt-3" onClick={onSave} disabled={saving}>
            <RotateCw size={16} /> Kaydetmeyi yeniden dene
          </Button>
        </div>
      )}
      <div className="flex justify-center">
        <Button disabled={saving || (!session.tutorial && !session.saved)} onClick={onBack}>
          {session.tutorial ? <BookOpen size={17} /> : <ArrowRight size={17} />}
          {session.tutorial ? "Kendi görevimi hazırla" : "Yeni görev hazırla"}
        </Button>
      </div>
    </section>
  );
}
