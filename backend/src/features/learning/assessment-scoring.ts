import type { AssessmentAction, GameSession } from "@yds-atlas/shared";
import { applyAssessmentAction } from "@yds-atlas/shared/game-engine";
import { HttpError } from "../../shared/errors";

export function invalidAssessment() {
  return new HttpError(400, "Değerlendirme adımları geçersiz veya eksik.", "INVALID_ASSESSMENT");
}

export function replayAssessment(snapshot: GameSession, actions: AssessmentAction[]) {
  let current = snapshot;
  for (const action of actions) {
    const next = applyAssessmentAction(current, action);
    if (next === current) throw invalidAssessment();
    current = next;
  }
  return current;
}
