import type { WordEntry } from "@yds-atlas/shared";
import { ArrowLeft, Layers3, Pencil, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MatchingPanel } from "@/features/learning-game/components/matching-panel";
import type { GameSession } from "@/features/learning-game/model/game-session";
import {
  retryMatching,
  selectMatching,
  startMatchingBoard,
} from "@/features/learning-game/model/matching-engine";
import { Button } from "@/shared/ui/button";
import {
  createDayReviewMatching,
  createDayReviewRounds,
  dayReviewBoardSize,
  dayReviewMissingMeanings,
} from "../model/day-review";

export function DayReviewPanel({
  day,
  words,
  onEditMissing,
  onExit,
}: {
  day: number;
  words: WordEntry[];
  onEditMissing?: (word: WordEntry) => void;
  onExit: () => void;
}) {
  const { t, i18n } = useTranslation();
  const missing = dayReviewMissingMeanings(words);
  const [visiblePairs] = useState(() => dayReviewBoardSize(window.innerWidth, window.innerHeight));
  const [rounds, setRounds] = useState(() => (missing.length ? [] : createDayReviewRounds(words)));
  const [roundIndex, setRoundIndex] = useState(0);
  const [session, setSession] = useState<GameSession | null>(() =>
    rounds[0] ? createDayReviewMatching(rounds[0], visiblePairs) : null,
  );
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
    if (!session?.matching || session.matching.matched.length !== session.matching.left.length)
      return;
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
  return (
    <section
      id="day-review"
      aria-label={
        i18n.language.startsWith("tr")
          ? `${day}. Gün · Tekrar Et`
          : t("library.daily.manage.reviewTitle", { day })
      }
      className="mx-auto mt-6 w-full max-w-5xl space-y-4 px-2 pb-10 sm:px-4"
    >
      <style>{`
        #day-review #matching-board {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          column-gap: .75rem;
          row-gap: .9rem;
        }
        #day-review #matching-board > * { margin-block-start: 0; }
        #day-review #matching-intro {
          grid-column: 1;
          grid-row: 1;
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: .65rem;
          min-width: 0;
          text-align: left;
          padding: 0;
        }
        #day-review #matching-intro > span {
          background: color-mix(in srgb,var(--color-primary, #f27637) 11%,transparent);
          color: var(--color-foreground);
          border: 1px solid var(--color-border);
          flex-shrink: 0;
        }
        #day-review #matching-intro h2 {
          color: var(--color-foreground);
          font-size: 1rem;
          font-weight: 700;
          line-height: 1.3;
        }
        #day-review #matching-board > div:nth-child(2) {
          grid-column: 2;
          grid-row: 1;
          display: flex;
          justify-content: flex-end;
          align-items: center;
          padding: 0;
          margin: 0;
          background: transparent;
          border: 0;
          box-shadow: none;
          min-height: 0;
        }
        #day-review #matching-board > div:nth-child(2) > span:first-child { display: none; }
        #day-review #matching-board > div:nth-child(2) > span:last-child {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          border-radius: .65rem;
          border: 1px solid color-mix(in srgb,var(--color-ring) 35%,var(--color-border));
          background: color-mix(in srgb,var(--color-primary, #f27637) 10%,var(--color-card));
          color: var(--color-foreground);
          padding: .5rem .75rem;
          font-size: .76rem;
          font-weight: 800;
          font-variant-numeric: tabular-nums;
        }
        #day-review #matching-board > div:nth-child(3),
        #day-review #matching-board > div:nth-child(4),
        #day-review #matching-board > button { grid-column: 1 / -1; }
        #day-review #matching-board > div:nth-child(3) { column-gap:.85rem; row-gap:.65rem; }
        @media (max-width: 420px) {
          #day-review #matching-intro h2 { font-size: .88rem; }
          #day-review #matching-board > div:nth-child(2) > span:last-child { font-size: .69rem; padding: .45rem .5rem; }
        }
        #day-review #matching-board [data-matching-side] { min-height: 3.15rem; border-radius: .8rem; border-width:1px; box-shadow:none; font-size:.875rem; padding:.75rem .9rem; background:var(--color-card); color:var(--color-card-foreground); border-color:var(--color-border); }
        #day-review #matching-board [data-matching-side]:hover:not(:disabled) { background:var(--color-accent); border-color:var(--color-ring); transform:translateY(-1px); }
        #day-review #matching-board [data-matching-side][aria-pressed="true"] { background:color-mix(in srgb,#f27637 11%,var(--color-card)); border-color:#f27637; outline: 2px solid color-mix(in srgb,#f27637 18%,transparent); }
        #day-review #matching-board [data-matching-side][class*="bg-emerald"] { background:color-mix(in srgb,#16a34a 12%,var(--color-card)); border-color:color-mix(in srgb,#16a34a 50%,var(--color-border)); color:var(--color-foreground); }
        #day-review #matching-board [data-matching-side][class*="bg-red"] { background:color-mix(in srgb,#dc2626 10%,var(--color-card)); border-color:#dc2626; color:var(--color-foreground); }
        #day-review #matching-board [data-matching-side]:focus-visible { outline: 3px solid var(--color-ring); outline-offset:2px; }
        #day-review #matching-feedback { min-height:2.9rem; border-radius:.85rem; font-size:.8rem; background:var(--color-card); color:var(--color-foreground); border-color:var(--color-border); }
        @media (max-width:520px) { #day-review #matching-board [data-matching-side] { font-size:.78rem; padding:.65rem .5rem; min-height:3.25rem; } }
      `}</style>
      <header
        id="day-review-header"
        className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm"
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 px-3 py-2 sm:gap-x-3 sm:px-5">
          <Button
            type="button"
            variant="outline"
            className="min-h-10 justify-self-start rounded-lg px-2 sm:px-3"
            onClick={onExit}
          >
            <ArrowLeft size={16} aria-hidden="true" /> {t("library.daily.manage.reviewExit")}
          </Button>
          <div className="relative min-w-0 text-center">
            <span className="absolute right-full top-1/2 mr-2 hidden size-8 -translate-y-1/2 items-center justify-center rounded-xl border border-[#f27637]/20 bg-[#f27637]/10 text-[#f27637] sm:inline-flex">
              <Layers3 size={19} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold tracking-tight text-foreground sm:text-lg">
                {i18n.language.startsWith("tr")
                  ? `${day}. Gün · Tekrar Et`
                  : t("library.daily.manage.reviewTitle", { day })}
              </h2>
            </div>
          </div>
          {session && !finished && (
            <span
              role="status"
              className="justify-self-end rounded-xl border border-border bg-background px-1.5 py-1 text-right text-[10px] font-semibold text-foreground sm:px-3 sm:text-[11px]"
            >
              {t("library.daily.manage.reviewRound", {
                current: roundIndex + 1,
                total: rounds.length,
                count: rounds[roundIndex].length,
              })}
            </span>
          )}
        </div>
        <p className="px-3 pb-2 text-center text-xs text-muted-foreground">
          {t("library.daily.manage.reviewReadOnly")}
        </p>
        {session && !finished && rounds.length > 0 && (
          <div
            className="h-1 w-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={rounds.length}
            aria-valuenow={roundIndex + 1}
            aria-label={
              i18n.language.startsWith("tr")
                ? `${day}. Gün · Tekrar Et`
                : t("library.daily.manage.reviewTitle", { day })
            }
          >
            <div
              className="h-full rounded-r-full bg-[#f27637] transition-[width] duration-300"
              style={{ width: `${((roundIndex + 1) / rounds.length) * 100}%` }}
            />
          </div>
        )}
      </header>
      {missing.length > 0 ? (
        <div
          role="alert"
          className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-5 text-sm text-foreground"
        >
          <p>{t("library.daily.manage.reviewMissing", { count: missing.length })}</p>
          {onEditMissing && (
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={() => onEditMissing(missing[0])}
            >
              <Pencil size={15} /> {t("library.daily.manage.reviewMissingAction")}
            </Button>
          )}
        </div>
      ) : finished ? (
        <div
          role="status"
          className="space-y-4 rounded-2xl border border-border bg-card p-6 text-center"
        >
          <h3 className="text-xl font-bold">{t("library.daily.manage.reviewFinished")}</h3>
          <div className="flex flex-wrap justify-center gap-3">
            <Button type="button" onClick={restart}>
              <RotateCcw size={16} /> {t("library.daily.manage.reviewRestart")}
            </Button>
            <Button type="button" variant="outline" onClick={onExit}>
              {t("library.daily.manage.reviewExit")}
            </Button>
          </div>
        </div>
      ) : session ? (
        <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm sm:p-6">
          <MatchingPanel
            session={session}
            practice
            nextLabel={t("library.daily.manage.reviewContinue")}
            onSelect={(side, id) =>
              setSession((current) => (current ? selectMatching(current, side, id) : current))
            }
            onRetry={() => setSession((current) => (current ? retryMatching(current) : current))}
            onNext={advanceBoard}
          />
        </div>
      ) : (
        <p role="alert">{t("library.daily.manage.reviewEmpty")}</p>
      )}
    </section>
  );
}
