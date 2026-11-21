import type { WordEntry } from "@yds-atlas/shared";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MatchingPanel } from "@/features/learning-game/components/matching-panel";
import { retryMatching, selectMatching, startMatchingBoard } from "@/features/learning-game/model/matching-engine";
import type { GameSession } from "@/features/learning-game/model/game-session";
import { Button } from "@/shared/ui/button";
import { createDayReviewMatching, createDayReviewRounds, dayReviewBoardSize, dayReviewMissingMeanings } from "../model/day-review";

export function DayReviewPanel({ day, words, onExit }: {
  day: number;
  words: WordEntry[];
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const missing = dayReviewMissingMeanings(words);
  const [visiblePairs] = useState(() => dayReviewBoardSize(window.innerWidth, window.innerHeight));
  const [rounds, setRounds] = useState(() => missing.length ? [] : createDayReviewRounds(words));
  const [roundIndex, setRoundIndex] = useState(0);
  const [session, setSession] = useState<GameSession | null>(() =>
    rounds[0] ? createDayReviewMatching(rounds[0], visiblePairs) : null);
  const [finished, setFinished] = useState(false);

  function restart() {
    const previous = rounds.flat().map((word) => word.id);
    const fresh = createDayReviewRounds(words, previous);
    setRounds(fresh);
    setRoundIndex(0);
    setSession(fresh[0] ? createDayReviewMatching(fresh[0], visiblePairs) : null);
    setFinished(false);
  }
  function advanceBoard() {
    if (!session?.matching || session.matching.matched.length !== session.matching.left.length) return;
    if (session.queue.length) {
      setSession(startMatchingBoard(session, visiblePairs));
    } else if (roundIndex + 1 < rounds.length) {
      const next = roundIndex + 1;
      setRoundIndex(next);
      setSession(createDayReviewMatching(rounds[next], visiblePairs));
    } else {
      setFinished(true);
    }
  }
  return <section id="day-review" aria-label={t("library.daily.manage.reviewTitle", { day })}
    className="mx-auto mt-2 w-full max-w-4xl space-y-2 sm:space-y-3">
    <header id="day-review-header"
      className="rounded-xl border border-border bg-muted/25 px-3 py-2 sm:px-4">
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_4.5rem] items-center gap-1 sm:grid-cols-[6rem_minmax(0,1fr)_6rem]">
        <Button type="button" variant="outline" className="min-h-11 justify-self-start px-2 sm:px-3" onClick={onExit}>
          <ArrowLeft size={16} /> {t("library.daily.manage.reviewExit")}
        </Button>
        <div className="min-w-0 text-center">
          <h2 className="text-sm font-semibold leading-5 text-foreground sm:text-base">
            {t("library.daily.manage.reviewTitle", { day })}
          </h2>
          {session && !finished && (
            <p role="status" className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              {t("library.daily.manage.reviewRound", { current: roundIndex + 1, total: rounds.length, count: rounds[roundIndex].length })}
            </p>
          )}
        </div>
        <span aria-hidden="true" />
      </div>
      <p role="note" className="mt-1 text-center text-[11px] leading-4 text-muted-foreground sm:text-xs">
        {t("library.daily.manage.reviewReadOnly")}
      </p>
    </header>
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
      <div className="space-y-2">
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
}
