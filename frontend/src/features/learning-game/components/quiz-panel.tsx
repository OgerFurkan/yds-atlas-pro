import { ArrowRight, Brain, Check, CheckCircle2, XCircle, Zap } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { isFinal, makeQuestion } from "../model/game-engine";
import type { Confidence, GameSession } from "../model/game-session";
import { AnswerFeedback } from "./answer-feedback";

export function QuizPanel({
  session,
  onAnswer,
  onConfidence,
  onNext,
}: {
  session: GameSession;
  onAnswer: (choice: string) => void;
  onConfidence: (value: Confidence) => void;
  onNext: () => void;
}) {
  const question = makeQuestion(session);
  if (!question) return null;
  const feedback = session.answer;
  const wrongChoice = question.choices.find((choice) => choice !== question.correct);
  return (
    <div className="space-y-5">
      <div id="question-sentence" className="py-4 text-center sm:py-6">
        <p className="mb-4 text-sm text-slate-500">
          {question.context
            ? "Cümledeki boşluğu hangi kelime tamamlar?"
            : "Bu kelime Türkçede ne anlama geliyor?"}
        </p>
        <h2
          className={cn(
            "mx-auto max-w-2xl break-words text-atlas-navy",
            question.context
              ? "text-xl leading-9 sm:text-2xl sm:leading-10"
              : "font-display text-4xl sm:text-5xl",
          )}
        >
          {question.context ? question.sentence : question.word.word}
        </h2>
      </div>
      <div id="question-choices" className="grid gap-3 sm:grid-cols-2">
        {question.choices.map((choice, index) => {
          const correct = !!feedback && choice === question.correct;
          const wrong = feedback?.choice === choice && !feedback.correct;
          return (
            <button
              id={
                choice === question.correct
                  ? "choice-correct"
                  : choice === wrongChoice
                    ? "choice-wrong"
                    : undefined
              }
              key={choice}
              type="button"
              disabled={!!feedback}
              aria-pressed={feedback?.choice === choice}
              onClick={() => onAnswer(choice)}
              className={cn(
                "group flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium transition active:scale-[0.98] disabled:cursor-default sm:text-base",
                correct
                  ? "border-emerald-400 bg-emerald-50 text-emerald-900"
                  : wrong
                    ? "border-red-400 bg-red-50 text-red-900"
                    : "border-slate-200 bg-white text-slate-700",
                !feedback && "hover:border-atlas-blue hover:bg-blue-50",
                !!feedback && !correct && !wrong && "bg-slate-50 text-slate-500",
              )}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-current/15 text-xs transition group-hover:scale-105">
                {String.fromCharCode(65 + index)}
              </span>
              <span className="min-w-0 flex-1 break-words">{choice}</span>
              {correct && <CheckCircle2 size={20} className="shrink-0" />}
              {wrong && <XCircle size={20} className="shrink-0" />}
            </button>
          );
        })}
      </div>
      {feedback && (
        <>
          <AnswerFeedback session={session} />
          {feedback.correct && isFinal(session) && (
            <fieldset id="answer-confidence" className="rounded-xl border bg-slate-50 p-4">
              <legend className="px-2 text-sm font-semibold text-slate-700">
                Bu kelimeyi nasıl hatırladın?
              </legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {(
                  [
                    [-10, "Zor hatırladım", Brain],
                    [0, "Hatırladım", Check],
                    [20, "Kolay hatırladım", Zap],
                  ] as const
                ).map(([value, label, Icon]) => (
                  <Button
                    key={value}
                    aria-pressed={feedback.confidence === value}
                    variant="outline"
                    className={cn(
                      value === -10
                        ? "border-red-200 bg-red-50 text-red-800 hover:border-red-400 hover:bg-red-100"
                        : value === 0
                          ? "border-amber-200 bg-amber-50 text-amber-900 hover:border-amber-400 hover:bg-amber-100"
                          : "border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-400 hover:bg-emerald-100",
                      feedback.confidence === value &&
                        (value === -10
                          ? "border-red-500 bg-red-600 text-white ring-2 ring-red-200 hover:bg-red-700"
                          : value === 0
                            ? "border-amber-500 bg-amber-500 text-white ring-2 ring-amber-200 hover:bg-amber-600"
                            : "border-emerald-600 bg-emerald-600 text-white ring-2 ring-emerald-200 hover:bg-emerald-700"),
                    )}
                    onClick={() => onConfidence(value)}
                  >
                    {feedback.confidence === value ? (
                      <CheckCircle2 size={16} />
                    ) : (
                      <Icon size={16} />
                    )}
                    {label}
                  </Button>
                ))}
              </div>
            </fieldset>
          )}
          <div className="flex justify-end">
            <Button
              id="question-next"
              disabled={isFinal(session) && feedback.correct && feedback.confidence === null}
              onClick={onNext}
            >
              Devam et <ArrowRight size={18} />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
