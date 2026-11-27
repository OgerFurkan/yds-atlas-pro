import type { GameSession, WordEntry } from "@yds-atlas/shared";
import { createSession } from "@yds-atlas/shared/game-engine";
import { starterVocabulary } from "@yds-atlas/shared/starter-vocabulary";
import { useEffect, useEffectEvent, useState } from "react";
import { playGuide } from "../model/play-guide";

export function useLearningTutorial(
  session: GameSession | null,
  commit: (next: GameSession) => void,
) {
  const [guide, setGuide] = useState(0);
  function tutorial() {
    const base = starterVocabulary.find((word) => word.word === "Expand");
    if (!base) return;
    const now = new Date().toISOString();
    const word: WordEntry = {
      ...base,
      id: "tutorial-expand",
      createdAt: now,
      updatedAt: now,
    };
    setGuide(0);
    commit(createSession([word], 5, true));
  }
  const beginTutorialFromHelp = useEffectEvent(() => {
    sessionStorage.removeItem("atlas:game-setup-help");
    tutorial();
  });
  useEffect(() => {
    if (!session) return;
    const begin = () => beginTutorialFromHelp();
    window.addEventListener("atlas:help-request", begin);
    if (sessionStorage.getItem("atlas:game-setup-help") === "1") begin();
    return () => window.removeEventListener("atlas:help-request", begin);
  }, [session]);
  function nextGuide() {
    setGuide((index) => Math.min(index + 1, playGuide.length - 1));
  }
  return { tutorial, nextGuide, guide };
}
