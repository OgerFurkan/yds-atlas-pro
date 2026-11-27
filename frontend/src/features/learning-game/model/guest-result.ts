import type { GameSession, WordEntry } from "@yds-atlas/shared";
import { recordDailyProgress } from "@/shared/lib/daily-progress";
import { getStorageScope } from "@/shared/lib/storage-scope";
import { persistSessionChange, readSession, sameSession } from "./game-storage";

// The caller holds the guest library lock and stages these changes as one result.
export function completeGuestResult(session: GameSession, listWords: () => WordEntry[]) {
  if (getStorageScope() !== null || session.phase !== "complete" || session.tutorial)
    throw new Error("Misafir çalışma sonucu doğrulanamadı.");
  const saved = { ...session, saved: true };
  if (sameSession(readSession(), saved)) return;
  const current = new Map(listWords().map((word) => [word.id, word]));
  const practicedIds = session.words
    .filter((word) => current.has(word.id))
    .map((word) => {
      if (current.get(word.id)?.updatedAt !== word.updatedAt)
        throw new Error("Çalışmadaki kelimeler başka bir işlemde değişti. Puanlar kaydedilmedi.");
      return word.id;
    });
  recordDailyProgress(practicedIds);
  persistSessionChange(saved, session);
}
