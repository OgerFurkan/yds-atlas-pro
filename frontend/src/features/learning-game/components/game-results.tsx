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
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const groups = [
    {
      id: "learned",
      label: t("game.groupResults.learned.0"),
      description: t("game.groupResults.learned.1"),
      icon: CheckCircle2,
      tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
    },
    {
      id: "review",
      label: t("game.groupResults.review.0"),
      description: t("game.groupResults.review.1"),
      icon: RotateCw,
      tone: "border-blue-200 bg-blue-50 text-blue-800",
    },
    {
      id: "hard",
      label: t("game.groupResults.hard.0"),
      description: t("game.groupResults.hard.1"),
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
          {session.tutorial ? t("game.tutorialBadge") : t("game.dailyBadge")}
        </Badge>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-atlas-navy">
          {session.tutorial ? t("game.tutorialTitle") : t("game.resultsTitle")}
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-slate-500">
          {t("game.wordsStudied", {
            count: session.words.length,
            total: session.finalTotal,
            correct: session.finalCorrect,
          })}
        </p>
        {session.tutorial ? (
          <p className="mt-3 text-sm leading-7 text-slate-500">{t("game.tutorialDescription")}</p>
        ) : (
          <p
            role="status"
            className="mt-4 flex items-center justify-center gap-2 text-sm text-atlas-blue"
          >
            {saving ? (
              <>
                <LoaderCircle className="animate-spin" size={17} /> {t("game.saving")}
              </>
            ) : session.saved ? (
              <>
                <CheckCircle2 size={18} /> {t("game.saved")}
              </>
            ) : (
              t("game.pending")
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
                    <li className="py-5 text-sm text-slate-400">{t("game.noGroupWords")}</li>
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
            <RotateCw size={16} /> {t("game.retrySave")}
          </Button>
        </div>
      )}
      <div className="flex justify-center">
        <Button disabled={saving || (!session.tutorial && !session.saved)} onClick={onBack}>
          {session.tutorial ? <BookOpen size={17} /> : <ArrowRight size={17} />}
          {session.tutorial ? t("game.prepareOwn") : t("game.prepareNew")}
        </Button>
      </div>
    </section>
  );
}
