import type { WordEntry } from "@yds-atlas/shared";
import { ArrowRight } from "lucide-react";
import { FlashcardBack, FlashcardFront } from "@/features/learning-game/components/flashcard-faces";
import { useCardFlip } from "@/features/learning-game/hooks/use-card-flip";
import { PronunciationButtons } from "@/features/word-library/components/pronunciation-buttons";
import { WordExample } from "@/features/word-library/components/word-example";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

interface FlashcardPanelProps {
  word: WordEntry;
  onNext: () => void;
  onFlip?: (back: boolean) => void;
  onPronounce?: () => void;
}

// Remounting per word resets the flip state without an effect (and without a reverse animation).
export function FlashcardPanel(props: FlashcardPanelProps) {
  return <FlashcardCard key={props.word.id} {...props} />;
}

function FlashcardCard({ word, onNext, onFlip, onPronounce }: FlashcardPanelProps) {
  const { back, revealed, turning, flip, finishTurn } = useCardFlip({ onFlip });
  const example = word.examples[0];

  return (
    <div className="mx-auto w-full min-w-0 space-y-5">
      <button
        id="atlas-card-flip"
        type="button"
        aria-label={back ? "Kartın ön yüzüne dön" : "Kartı çevir ve anlamı göster"}
        aria-describedby={back ? "word-information" : undefined}
        aria-pressed={back}
        aria-disabled={turning}
        onClick={flip}
        className="group mx-auto block w-full max-w-100 cursor-pointer rounded-3xl text-left outline-offset-4 focus-visible:outline-2 focus-visible:outline-atlas-orange aria-disabled:cursor-wait"
        style={{ perspective: "50rem", WebkitPerspective: "50rem" }}
      >
        <span
          data-testid="atlas-card-faces"
          data-side={back ? "back" : "front"}
          className={cn(
            "relative grid w-full rounded-3xl transform-3d",
            "transition duration-1000",
            back && "transform-[rotateY(180deg)]",
          )}
          style={{
            WebkitTransformStyle: "preserve-3d",
          }}
          onTransitionEnd={(event) => {
            if (event.target === event.currentTarget && event.propertyName === "transform") {
              finishTurn();
            }
          }}
        >
          <FlashcardFront word={word} hidden={back} />
          <FlashcardBack word={word} hidden={!back} />
        </span>
      </button>

      {revealed && (
        <div className="w-full min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <PronunciationButtons
              word={word.word}
              uk={word.pronunciationUk}
              us={word.pronunciationUs}
              onComplete={onPronounce}
            />
          </div>

          {example && (
            <div id="word-example" className="w-full min-w-0 wrap-break-word *:max-w-none">
              <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500">
                CÜMLE İÇİNDE GÖR
              </p>
              <WordExample word={word} example={example} />
            </div>
          )}
        </div>
      )}

      <Button
        id="flashcard-next"
        className="flex w-full sm:ml-auto sm:w-auto"
        disabled={!revealed || turning}
        onClick={onNext}
      >
        Bir sonraki kelime <ArrowRight size={18} />
      </Button>
    </div>
  );
}
