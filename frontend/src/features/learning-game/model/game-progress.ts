import { groupWords, isFinal } from "./game-engine";
import type { GameSession } from "./game-session";

export function gameProgress(session: GameSession) {
  const groups = Math.ceil(session.words.length / session.batchSize);
  const final = isFinal(session);
  const active =
    session.phase === "flashcards"
      ? 0
      : session.phase === "meaning"
        ? 1
        : session.phase === "context"
          ? 2
          : 3;
  const stageTotal = final ? session.words.length : groupWords(session).length;
  const completed = final
    ? groups * 3 +
      (session.phase === "final-context"
        ? session.version === 3
          ? 2
          : 1
        : session.phase === "final-meaning" && session.version === 3
          ? 1
          : 0)
    : session.groupIndex * 3 + active;
  const percent = Math.round(
    ((completed + session.stageCompleted / stageTotal) /
      (groups * 3 + (session.version === 3 ? 3 : 2))) *
      100,
  );
  return { groups, final, active, percent };
}
