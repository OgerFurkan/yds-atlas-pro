import { Square, Volume2 } from "lucide-react";
import { usePronunciation } from "@/shared/hooks/use-pronunciation";
import { Button } from "@/shared/ui/button";

export function PronunciationButtons({
  word,
  uk,
  us,
  onComplete,
}: {
  word: string;
  uk?: string;
  us?: string;
  onComplete?: () => void;
}) {
  const speech = usePronunciation();
  return (
    <div id="word-pronunciation" className="space-y-2">
      <div className="flex flex-wrap justify-center gap-2">
        {(["UK", "US"] as const).map((accent) => (
          <Button
            key={accent}
            id={`pronunciation-${accent.toLowerCase()}`}
            variant="outline"
            size="sm"
            aria-label={`${accent} telaffuzunu ${speech.active === accent ? "durdur" : "dinle"}`}
            aria-pressed={speech.active === accent}
            onClick={async () => {
              const result = await speech.play(word, accent, accent === "UK" ? uk : us);
              if (result === "ended") onComplete?.();
            }}
            className="text-blue"
          >
            {speech.active === accent ? (
              <Square size={14} />
            ) : (
              <Volume2 size={16} className="text-atlas-orange" />
            )}{" "}
            {accent}
            <span className="text-xs font-normal">
              {speech.active === accent ? "Durdur" : "Dinle"}
            </span>
          </Button>
        ))}
      </div>
      {speech.error && (
        <p role="status" className="text-center text-xs text-red-700">
          {speech.error}
          {onComplete && (
            <Button
              id="pronunciation-recovery"
              className="relative"
              variant="link"
              size="sm"
              onClick={onComplete}
            >
              Bu adımı sessiz geç
            </Button>
          )}
        </p>
      )}
    </div>
  );
}
