import { CheckCircle2, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PronunciationButtons } from "@/features/word-library/components/pronunciation-buttons";
import { WordExample } from "@/features/word-library/components/word-example";
import { SentenceWordTooltips } from "@/features/word-library/components/sentence-word-tooltips";
import { TieredSentencePreview } from "@/features/word-inspector/components/tiered-sentence-preview";
import { hasAtlasTiers, ATLAS_TIER_ORDER } from "@/features/word-library/model/tiered-examples";
import { formatWordType } from "@/features/word-library/model/word-normalization";
import { cn } from "@/shared/lib/utils";
import { makeQuestion } from "../model/game-engine";
import type { GameSession } from "../model/game-session";

export function AnswerFeedback({ session }: { session: GameSession }) {
  const { t } = useTranslation();
  const question = makeQuestion(session);
  if (!question || !session.answer) return null;
  const { word } = question;
  const correct = session.answer.correct;
  const example = question.context ? question.example : word.examples[0];
  return (
    <section
      id="answer-feedback"
      aria-live="polite"
      className={cn(
        "overflow-hidden rounded-xl border",
        correct ? "border-emerald-200 bg-emerald-50/60" : "border-red-200 bg-red-50/70",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-3 border-b px-4 py-4 sm:px-5",
          correct ? "border-emerald-100 text-emerald-900" : "border-red-100 text-red-900",
        )}
      >
        {correct ? (
          <CheckCircle2 size={25} className="shrink-0 text-emerald-600" />
        ) : (
          <XCircle size={25} className="shrink-0 text-red-500" />
        )}
        <div>
          <h3 className="font-semibold">{correct ? t("game.correct") : t("game.incorrect")}</h3>
          <p className="mt-1 text-sm">
            {correct
              ? question.context
                ? t("game.correctContext")
                : t("game.correctMeaning")
              : t("game.feedbackHint")}
          </p>
        </div>
      </div>
      <div className="space-y-4 p-4 sm:p-5">
        {!correct && (
          <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg bg-white/80 p-3 text-sm">
            <span className="text-slate-500">
              {t("game.yourAnswer")}{" "}
              <span className="font-medium text-red-700 line-through">{session.answer.choice}</span>
            </span>
            <span className="text-slate-600">
              {t("game.correctAnswer")}{" "}
              <strong className="text-atlas-navy">{question.correct}</strong>
            </span>
          </div>
        )}
        <div>
          <p className="text-lg font-semibold text-atlas-navy">
            <SentenceWordTooltips text={word.word} focusWord={word} allowDuringGame />{" "}
            <span className="text-sm font-normal capitalize text-slate-500">
              · {formatWordType(word.partOfSpeech)}
            </span>
          </p>
          <p className="mt-1 font-semibold text-slate-800">{word.meanings.join(" · ")}</p>
          {word.usageNote && (
            <p className="mt-2 text-sm leading-7 text-slate-600">{word.usageNote}</p>
          )}
        </div>
        {example && <WordExample word={word} example={example} compact />}
        {hasAtlasTiers(word.examples) ? (
          <details className="rounded-xl border border-slate-200 bg-white p-3 text-slate-800">
            <summary className="cursor-pointer font-semibold">5 seviyeli örneği gör · 2 kolay / 1 orta / 2 YDS</summary>
            <ol className="mt-3 space-y-4">
              {word.examples.slice(0, 5).map((item, index) => (
                <li key={index} className="border-t border-slate-100 pt-3">
                  <span className="mb-2 block text-xs font-bold uppercase text-atlas-blue">{index + 1}. {ATLAS_TIER_ORDER[index]}</span>
                  <WordExample word={word} example={item} compact />
                </li>
              ))}
            </ol>
          </details>
        ) : <TieredSentencePreview word={word.word} />}
        <PronunciationButtons
          word={word.word}
          uk={word.pronunciationUk}
          us={word.pronunciationUs}
        />
      </div>
    </section>
  );
}
