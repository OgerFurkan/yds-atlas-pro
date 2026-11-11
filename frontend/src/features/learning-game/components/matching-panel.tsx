import { ArrowRight, Check, CheckCheck, Languages, Link2, RotateCcw, X } from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import type { GameSession } from "../model/game-session";

export function MatchingPanel({
  session,
  onSelect,
  onRetry,
  onNext,
}: {
  session: GameSession;
  onSelect: (side: "left" | "right", id: string) => void;
  onRetry: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const board = session.matching;
  if (!board) return null;
  const complete = board.matched.length === board.left.length;
  const feedback = board.feedback;
  const leftWord = session.words.find((word) => word.id === feedback?.leftId);
  const rightWord = session.words.find((word) => word.id === feedback?.rightId);
  return (
    <div id="matching-board" className="space-y-5">
      <div id="matching-intro" className="space-y-2 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-blue-50 text-atlas-blue">
          <Languages size={25} />
        </span>
        <h2 className="text-2xl font-bold tracking-tight text-atlas-navy">
          {t("game.matchingTitle")}
        </h2>
        <p className="mx-auto max-w-lg text-sm leading-6 text-slate-500">
          {t("game.matchingDescription")}
        </p>
      </div>
      <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600">
        <span className="flex items-center gap-2">
          <Link2 size={16} /> {t("game.matchingSet")}
        </span>
        <span>
          {board.matched.length} / {board.left.length} {t("game.matched")}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:gap-x-8">
        <span className="px-2 text-xs font-bold tracking-wide text-atlas-blue">
          {t("game.english")}
        </span>
        <span className="px-2 text-xs font-bold tracking-wide text-atlas-blue">
          {t("game.turkish")}
        </span>
        {board.left.map((leftId, index) => (
          <Fragment key={leftId}>
            {(["left", "right"] as const).map((side) => {
              const id = side === "left" ? leftId : board.right[index];
              const word = session.words.find((entry) => entry.id === id);
              if (!word) return null;
              const matched = board.matched.includes(id);
              const selected = (side === "left" ? board.selectedLeft : board.selectedRight) === id;
              const wrong =
                feedback?.correct === false &&
                (side === "left" ? feedback.leftId : feedback.rightId) === id;
              return (
                <button
                  key={side}
                  id={index === 0 ? `matching-${side}` : undefined}
                  data-matching-side={side}
                  data-word-id={id}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`${t(side === "left" ? "game.leftWord" : "game.rightWord")}: ${side === "left" ? word.word : word.meanings[0]}${matched ? `, ${t("game.paired")}` : ""}`}
                  disabled={matched || feedback?.correct === false}
                  onClick={() => onSelect(side, id)}
                  className={cn(
                    "flex min-h-17 min-w-0 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 px-3 py-4 text-center text-sm font-semibold shadow-[0_3px_0_#e2e8f0] transition active:translate-y-0.5 active:shadow-none disabled:cursor-default sm:min-h-19 sm:text-base",
                    matched
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700 shadow-none"
                      : wrong
                        ? "border-red-400 bg-red-50 text-red-800 shadow-[0_3px_0_#fecaca]"
                        : selected
                          ? "border-atlas-blue bg-blue-50 text-atlas-navy shadow-[0_3px_0_#bdd6e8] ring-2 ring-blue-100"
                          : "border-slate-200 bg-white text-atlas-navy enabled:hover:border-atlas-blue/60 enabled:hover:bg-blue-50/50",
                  )}
                >
                  {matched && <Check size={17} className="shrink-0" />}
                  <span className="min-w-0 break-words">
                    {side === "left" ? word.word : word.meanings[0]}
                  </span>
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
      <div
        id="matching-feedback"
        role="status"
        aria-live="polite"
        className={cn(
          "flex min-h-18 flex-wrap items-center gap-3 rounded-xl border p-4 text-sm",
          complete || feedback?.correct
            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : feedback
              ? "border-red-200 bg-red-50 text-red-900"
              : "border-dashed border-slate-200 text-slate-500",
        )}
      >
        {complete ? (
          <>
            <CheckCheck size={23} />
            <div>
              <strong className="block">{t("game.allMatched")}</strong>
              <span className="text-xs">
                {session.queue.length ? t("game.nextWords") : t("game.recallMeaning")}
              </span>
            </div>
          </>
        ) : feedback?.correct ? (
          <>
            <Check size={21} />
            <span>
              <strong>{leftWord?.word}</strong> ile <strong>{leftWord?.meanings[0]}</strong>{" "}
              {t("game.pairMatched")}
            </span>
          </>
        ) : feedback ? (
          <>
            <X size={21} />
            <div className="min-w-0 flex-1">
              <strong className="block">{t("game.wrongPair")}</strong>
              <span className="text-xs">
                {leftWord?.word}: {leftWord?.meanings[0]} · {rightWord?.meanings[0]}:{" "}
                {rightWord?.word}
              </span>
            </div>
            <Button
              id="matching-retry"
              variant="outline"
              className="border-red-200 text-red-800 hover:bg-red-100"
              onClick={onRetry}
            >
              <RotateCcw size={15} /> {t("game.retry")}
            </Button>
          </>
        ) : (
          <>
            <Link2 size={19} />
            <span>
              {board.selectedLeft || board.selectedRight
                ? t("game.chooseOther")
                : t("game.chooseFirst")}
            </span>
          </>
        )}
      </div>
      {complete && (
        <Button id="matching-next" className="w-full sm:ml-auto sm:flex sm:w-auto" onClick={onNext}>
          {session.queue.length ? t("game.nextMatching") : t("game.toMeaning")}
          <ArrowRight size={17} />
        </Button>
      )}
    </div>
  );
}
