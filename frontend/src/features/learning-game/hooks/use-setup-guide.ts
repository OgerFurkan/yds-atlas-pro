import { useState } from "react";
import type { SetupSource } from "../model/game-setup";
import { setupGuide } from "../model/tutorial-steps";

export function useSetupGuide({
  onReset,
  onSourceChange,
}: {
  onReset: () => void;
  onSourceChange: (source: SetupSource) => void;
}) {
  const [guide, setGuide] = useState<number | null>(null);

  function start() {
    onSourceChange("starter");
    setGuide(0);
  }

  function finish() {
    setGuide(null);
    onReset();
  }

  function next() {
    if (guide === null) return;
    if (guide === setupGuide.length - 1) {
      finish();
      return;
    }
    if (guide === 2) onSourceChange("library");
    if (guide === 3) onSourceChange("own");
    setGuide(guide + 1);
  }

  return { guide, start, finish, next, goTo: setGuide };
}
