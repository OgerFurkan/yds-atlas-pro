import { groupWords, isFinal } from "./game-engine";
import type { GameSession } from "./game-session";
export function gameProgress(session: GameSession) {
  const groups = Math.ceil(session.words.length / session.batchSize);
  const final = isFinal(session);
  const stages = session.groupMatching
    ? ["flashcards", "matching", "meaning", "context"]
    : ["flashcards", "meaning", "context"];
  const active =
    final || session.phase === "complete" ? stages.length : stages.indexOf(session.phase);
  const finals =
    session.version === 3
      ? ["final-matching", "final-meaning", "final-context"]
      : ["final-meaning", "final-context"];
  const stageTotal = final ? session.words.length : groupWords(session).length;
  const completed = final
    ? groups * stages.length + finals.indexOf(session.phase)
    : session.groupIndex * stages.length + active;
  const percent =
    session.phase === "complete"
      ? 100
      : Math.round(
          ((completed + session.stageCompleted / stageTotal) /
            (groups * stages.length + finals.length)) *
            100,
        );
  return { groups, final, active, percent };
}
