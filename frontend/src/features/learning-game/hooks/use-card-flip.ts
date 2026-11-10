import { useEffect, useRef, useState } from "react";

export const FLIP_DURATION_MS = 1000;

// Safety net for browsers that skip `transitionend` (e.g. background tabs).
const FLIP_FALLBACK_MS = FLIP_DURATION_MS + 120;

export function useCardFlip({ onFlip }: { onFlip?: (back: boolean) => void }) {
  const [back, setBack] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [turning, setTurning] = useState(false);
  const turningRef = useRef(false);
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timeoutRef.current), []);

  function finish(nextBack: boolean) {
    if (!turningRef.current) return;
    window.clearTimeout(timeoutRef.current);
    turningRef.current = false;
    setTurning(false);
    if (nextBack) setRevealed(true);
    onFlip?.(nextBack);
  }

  function flip() {
    if (turningRef.current) return;
    const nextBack = !back;
    turningRef.current = true;
    setTurning(true);
    setBack(nextBack);

    timeoutRef.current = window.setTimeout(() => finish(nextBack), FLIP_FALLBACK_MS);
  }

  return { back, revealed, turning, flip, finishTurn: () => finish(back) };
}
