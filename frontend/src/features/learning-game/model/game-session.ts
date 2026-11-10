export {
  phases,
  phaseLabels,
  sessionWordSchema,
  wordAssessmentSchema,
  matchingSchema,
  gameSessionSchema,
  type GamePhase,
  type GameSession,
  type Confidence,
  type WordAssessment,
} from "@yds-atlas/shared";
import { storageKeys } from "@/shared/lib/storage-keys";
export const gameStorageKey = storageKeys.gameSession;
