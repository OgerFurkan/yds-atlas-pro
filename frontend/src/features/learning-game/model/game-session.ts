export {
  type Confidence,
  type GamePhase,
  type GameSession,
  gameSessionSchema,
  matchingSchema,
  phaseLabels,
  phases,
  sessionWordSchema,
  type WordAssessment,
  wordAssessmentSchema,
} from "@yds-atlas/shared";

import { storageKeys } from "@/shared/lib/storage-keys";
export const gameStorageKey = storageKeys.gameSession;
