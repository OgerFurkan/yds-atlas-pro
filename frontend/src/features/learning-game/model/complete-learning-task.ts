import type { GameSession } from "./game-session";
import type { LearningGamePageProps } from "./learning-task";

export async function completeLearningTask(
  session: GameSession,
  complete: LearningGamePageProps["onCompleteSession"],
  applyScores: LearningGamePageProps["onApplyScores"],
): Promise<boolean> {
  if (session.localPractice) return true;
  if (complete) return (await complete(session)).practiceOnly;
  await applyScores(session);
  return true;
}
