import type { WordEntry } from "@yds-atlas/shared";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MatchingPanel } from "@/features/learning-game/components/matching-panel";
import { retryMatching, selectMatching, startMatchingBoard } from "@/features/learning-game/model/matching-engine";
import type { GameSession } from "@/features/learning-game/model/game-session";
import { Button } from "@/shared/ui/button";
import { createDayReviewMatching, createDayReviewRounds, dayReviewMissingMeanings } from "../model/day-review";

export function DayReviewPanel({ day, words, onExit }: {
  day: number;
  words: WordEntry[];
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const missing = dayReviewMissingMeanings(words);
  const [rounds, setRounds] = useState(() => missing.length ? [] : createDayReviewRounds(words));
  const [roundIndex, setRoundIndex] = useState(0);
  const [session, setSession] = useState<GameSession | null>(() =>
    rounds[0] ? createDayReviewMatching(rounds[0]) : null);
  const [finished, setFinished] = useState(false);

  function restart() {
    const previous = rounds.flat().map((word) => word.id);
    const fresh = createDayReviewRounds(words, previous);
    setRounds(fresh);
    setRoundIndex(0);
    setSession(fresh[0] ? createDayReviewMatching(fresh[0]) : null);
    setFinished(false);
  }
  function advanceBoard() {
    if (!session?.matching || session.matching.matched.length !== session.matching.left.length) return;
    if (session.queue.length) {
      setSession(startMatchingBoard(session, 10));
    } else if (roundIndex + 1 < rounds.length) {
      const next = roundIndex + 1;
      setRoundIndex(next);
      setSession(createDayReviewMatching(rounds[next]));
    } else {
      setFinished(true);
    }
  }
  return <section id="day-review" aria-label={t("library.daily.manage.reviewTitle", { day })}
    className="mx-auto mt-5 w-full max-w-4xl space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button type="button" variant="outline" onClick={onExit}><ArrowLeft size={16} /> {t("library.daily.manage.reviewExit")}</Button>
      <h2 className="text-xl font-semibold text-foreground">{t("library.daily.manage.reviewTitle", { day })}</h2>
    </div>
    <p role="note" className="rounded-xl border border-border bg-muted/40 p-3 text-sm text-foreground">
      {t("library.daily.manage.reviewReadOnly")}
    </p>
    {missing.length > 0 ? (
      <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        {t("library.daily.manage.reviewMissing", { count: missing.length })}
      </div>
    ) : finished ? (
      <div role="status" className="space-y-4 rounded-2xl border border-border bg-card p-6 text-center">
        <h3 className="text-xl font-bold">{t("library.daily.manage.reviewFinished")}</h3>
        <div className="flex flex-wrap justify-center gap-3">
          <Button type="button" onClick={restart}><RotateCcw size={16} /> {t("library.daily.manage.reviewRestart")}</Button>
          <Button type="button" variant="outline" onClick={onExit}>{t("library.daily.manage.reviewExit")}</Button>
        </div>
      </div>
    ) : session ? (
      <div className="space-y-4">
        <div role="status" className="text-center text-sm font-semibold text-foreground">
          {t("library.daily.manage.reviewRound", { current: roundIndex + 1, total: rounds.length, count: rounds[roundIndex].length })}
        </div>
        <MatchingPanel session={session} practice
          nextLabel={t("library.daily.manage.reviewContinue")}
          onSelect={(side, id) => setSession((current) => current ? selectMatching(current, side, id) : current)}
          onRetry={() => setSession((current) => current ? retryMatching(current) : current)}
          onNext={advanceBoard}
        />
      </div>
    ) : (
      <p role="alert">{t("library.daily.manage.reviewEmpty")}</p>
    )}
  </section>;
