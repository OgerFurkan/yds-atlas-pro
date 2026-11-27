import { Square, Volume2 } from "lucide-react";
import { usePronunciation } from "@/shared/hooks/use-pronunciation";
import { Button } from "@/shared/ui/button";

export function PronunciationButtons({
  word,
  uk,
  us,
  onComplete,
  compact = false,
}: {
  word: string;
  uk?: string;
  us?: string;
  compact?: boolean;
  onComplete?: () => void;
}) {
  const speech = usePronunciation();
  return (
    <div id={compact ? undefined : "word-pronunciation"} className="space-y-2">
      <div className={compact ? "my-2 flex gap-2" : "flex flex-wrap justify-center gap-2"}>
        {(["UK", "US"] as const).map((accent) => (
          <Button
            key={accent}
            id={compact ? undefined : `pronunciation-${accent.toLowerCase()}`}
            variant="outline"
            size="sm"
            aria-label={`${accent} telaffuzunu ${speech.active === accent ? "durdur" : "dinle"}`}
            aria-pressed={speech.active === accent}
            onClick={async () => {
              const result = await speech.play(word, accent, accent === "UK" ? uk : us);
              if (result === "ended") onComplete?.();
            }}
            className={compact ? "atlas-tooltip-audio" : "text-blue"}
          >
            {speech.active === accent ? (
              <Square size={14} />
            ) : (
              <Volume2 size={16} className="text-atlas-orange" />
            )}{" "}
            {compact ? (accent === "UK" ? "British" : "American") : accent}
            {!compact && (
              <span className="text-xs font-normal">
                {speech.active === accent ? "Durdur" : "Dinle"}
              </span>
            )}
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
