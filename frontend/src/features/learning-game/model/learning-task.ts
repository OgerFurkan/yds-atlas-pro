import type { WordEntry, WordInput } from "@yds-atlas/shared";
import type { DailyGroupPreset } from "@/features/word-library/model/daily-groups";
import type { WordFillProgress } from "@/features/word-library/model/prepare-word-inputs";
import type { Notify } from "@/shared/lib/notify";
import { createSession } from "./game-engine";
import type { GameSession } from "./game-session";

export interface LearningGamePageProps {
  onlineOwner?: string;
  onOnlineFinished?: () => Promise<void>;
  words: WordEntry[];
  onBack: () => void;
  onNotify: Notify;
  onOpenLibrary: () => void;
  onAddMany: (
    words: WordInput[],
    onProgress?: (progress: WordFillProgress) => void,
  ) => Promise<{ added: number; duplicates: number }>;
  onApplyScores: (session: GameSession) => Promise<void>;
  listWords: () => WordEntry[];
  preset?: DailyGroupPreset | null;
  onPresetHandled?: () => void;
  onPersistSession?: (session: GameSession) => Promise<void>;
  onCompleteSession?: (session: GameSession) => Promise<{ practiceOnly: boolean }>;
}

export function createTask(words: WordEntry[], batch: 5 | 10, account: boolean): GameSession {
  const session = createSession(words, batch);
  return account ? { ...session, assessmentActions: [] } : session;
}
