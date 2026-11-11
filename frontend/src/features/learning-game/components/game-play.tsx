import { Badge } from "@/shared/ui/badge";
import { Card, CardContent } from "@/shared/ui/card";
import { currentWord, groupWords, isFinal } from "../model/game-engine";
import { type Confidence, type GameSession, phaseLabels } from "../model/game-session";
import { FlashcardPanel } from "./flashcard-panel";
import { MatchingPanel } from "./matching-panel";
import { QuizPanel } from "./quiz-panel";

export function GamePlay({
  session,
  onRemember,
  onAnswer,
  onConfidence,
  onNext,
  onFlip,
  onPronounce,
  onMatch,
  onMatchRetry,
  onMatchNext,
}: {
  session: GameSession;
  onRemember: (remembered: boolean) => void;
  onAnswer: (choice: string) => void;
  onConfidence: (value: Confidence) => void;
  onNext: () => void;
  onFlip?: (back: boolean) => void;
  onPronounce?: () => void;
  onMatch: (side: "left" | "right", id: string) => void;
  onMatchRetry: () => void;
  onMatchNext: () => void;
}) {
  const word = currentWord(session);
  if (!word && !session.phase.endsWith("matching")) return null;
  const total = isFinal(session) ? session.words.length : groupWords(session).length;
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <CardContent className="space-y-5 p-4 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge variant="secondary">{phaseLabels[session.phase]}</Badge>
            <span className="text-sm text-slate-500">
              {session.stageCompleted} / {total} tamamlandı
            </span>
          </div>
          {session.phase.endsWith("matching") ? (
            <MatchingPanel
              session={session}
              onSelect={onMatch}
              onRetry={onMatchRetry}
              onNext={onMatchNext}
            />
          ) : session.phase === "flashcards" && word ? (
            <FlashcardPanel
              word={word}
              onNext={() => onRemember(true)}
              onFlip={onFlip}
              onPronounce={onPronounce}
            />
          ) : (
            <QuizPanel
              session={session}
              onAnswer={onAnswer}
              onConfidence={onConfidence}
              onNext={onNext}
            />
          )}
        </CardContent>
      </Card>
      <p className="text-center text-xs leading-6 text-slate-500">
        {session.phase === "flashcards"
          ? "Kelimeyi ve örneği incele. Hazır olduğunda sonraki kelimeye geç."
          : "Acele etme. Anlamı düşün, sonra yanıtını seç."}
      </p>
    </div>
  );
}
