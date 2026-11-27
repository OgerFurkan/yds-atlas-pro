import type { WordEntry } from "@yds-atlas/shared";
import type { TFunction } from "i18next";
import { hasActiveLocalGame, readSession } from "@/features/learning-game/task-storage";
import type { Notify } from "@/shared/lib/notify";
import { getStorageScope } from "@/shared/lib/storage-scope";
import { localWordRepository } from "../api/local-word-repository";
import type { DayRemoval } from "../components/day-removal-dialog";
import type { useAccountPlan } from "../hooks/use-account-plan";
import type { useDailyPlan } from "../hooks/use-daily-plan";

export function libraryDayCommands(
  daily: ReturnType<typeof useDailyPlan> | ReturnType<typeof useAccountPlan>,
  words: WordEntry[],
  accountId: string | null,
  onNotify: Notify,
  onRemoveMany: (ids: string[], beforeRemove?: () => void) => Promise<void>,
  t: TFunction,
) {
  async function assignWord(wordId: string, day: number) {
    try {
      const group = daily.plan.groups[day - 1];
      if (!group || (group.total >= 40 && !group.words.some((word) => word.id === wordId))) {
        onNotify.error("Bir güne en fazla 40 kelime eklenebilir.");
        return;
      }
      if (await daily.assign(wordId, day)) onNotify.success(`${day}. gün güncellendi.`);
      else onNotify.error("Kelime bu güne atanamadı. Günün kapasitesini kontrol et.");
    } catch (reason) {
      onNotify.error(reason instanceof Error ? reason.message : "Kelime güne atanamadı.");
    }
  }

  async function removeWordFromDay(wordId: string, day: number) {
    try {
      await daily.removeFromDay(wordId, day);
      onNotify.success("Kelime plandan çıkarıldı; kütüphanede duruyor.");
    } catch (reason) {
      onNotify.error(reason instanceof Error ? reason.message : "Kelime plandan çıkarılamadı.");
    }
  }

  async function clearPlanDay(day: number, expected: string) {
    try {
      if (!(await daily.clearDay(day, expected))) return false;
      onNotify.success(t("library.daily.manage.dayCleared", { day }));
      return true;
    } catch {
      return false;
    }
  }

  function getDayRemoval(day: number): DayRemoval | null {
    const removal = daily.getDayRemoval(day);
    if (!removal) return null;
    const { ids } = removal;
    const session = readSession();
    const activeWord =
      session && !session.saved && session.words.some((word) => ids.includes(word.id));
    const unknownTask = !session && hasActiveLocalGame();
    const blocked = accountId ? "account" : activeWord || unknownTask ? "task" : null;
    const revisions = new Map(words.map((word) => [word.id, word.updatedAt]));
    return { ...removal, blocked, wordRevisions: ids.map((id) => revisions.get(id) ?? "") };
  }

  async function deleteDayWords(day: number, expected: DayRemoval) {
    await onRemoveMany(expected.ids, () => {
      const removal = getDayRemoval(day);
      if (!removal) throw new Error(t("library.daily.manage.deleteDayChanged"));
      const { ids, conflicts, blocked } = removal;
      if (
        accountId ||
        getStorageScope() !== null ||
        blocked ||
        conflicts.length ||
        !ids.length ||
        removal.planRevision !== expected.planRevision ||
        JSON.stringify(removal.wordRevisions) !== JSON.stringify(expected.wordRevisions) ||
        localWordRepository.list().filter((word) => ids.includes(word.id)).length !== ids.length
      )
        throw new Error(t("library.daily.manage.deleteDayChanged"));
      // The guest repository commits the word batch in one localStorage write.
      // The normal plan sync removes references to those now-missing words.
    });
    onNotify.success(t("library.daily.manage.dayWordsDeleted", { count: expected.ids.length }));
  }

  return { assignWord, removeWordFromDay, clearPlanDay, getDayRemoval, deleteDayWords };
}
