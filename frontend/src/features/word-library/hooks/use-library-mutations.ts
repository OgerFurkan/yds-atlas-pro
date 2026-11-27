import type { WordEntry, WordInput } from "@yds-atlas/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { WordAddMode } from "@/features/word-library/model/manual-word-import";
import type { WordFillProgress } from "@/features/word-library/model/prepare-word-inputs";
import { wordKey } from "@/features/word-library/model/word-normalization";
import type { WordLibraryPageProps } from "../components/word-library-page";
import { isDayStudyReady } from "../model/daily-groups";
import { libraryDayCommands } from "../model/library-day-commands";
import type { useAccountPlan } from "./use-account-plan";
import type { useDailyPlan } from "./use-daily-plan";
import type { useWordSelection } from "./use-word-selection";

type LocalPlan = ReturnType<typeof useDailyPlan>;
type CloudPlan = ReturnType<typeof useAccountPlan>;

export function useLibraryMutations({
  initialCreate,
  words,
  accountId,
  cloudPlanEnabled,
  selection,
  daily,
  local,
  cloud,
  listStudyWords,
  onReload,
  onAddMany,
  onSave,
  onRemoveMany,
  onRemove,
  onNotify,
  onInitialCreateHandled,
}: Pick<
  WordLibraryPageProps,
  | "words"
  | "listStudyWords"
  | "onReload"
  | "onAddMany"
  | "onSave"
  | "onRemoveMany"
  | "onRemove"
  | "onNotify"
  | "onInitialCreateHandled"
> & {
  initialCreate: boolean;
  accountId: string | null;
  cloudPlanEnabled: boolean;
  selection: ReturnType<typeof useWordSelection>;
  daily: LocalPlan | CloudPlan;
  local: LocalPlan;
  cloud: CloudPlan;
}) {
  const { t } = useTranslation();
  const [formOpen, setFormOpen] = useState(initialCreate);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkTargetDay, setBulkTargetDay] = useState<number | null>(null);
  const [editingWord, setEditingWord] = useState<WordEntry>();
  const [createTargetDay, setCreateTargetDay] = useState<number | null>(null);
  function bulkAddForDay(day: number) {
    setBulkTargetDay(day);
    setBulkOpen(true);
  }

  function openGeneralBulk() {
    setBulkTargetDay(null);
    setBulkOpen(true);
  }

  async function bulkAssignWordIds(wordIds: string[], day: number) {
    try {
      const result = await daily.assignMany(wordIds, day);
      onNotify.success(`${result.added} kelime eklendi, ${result.moved} kelime taşındı.`);
      return true;
    } catch (reason) {
      onNotify.error(reason instanceof Error ? reason.message : "Kelimeler güne atanamadı.");
      return false;
    }
  }

  async function addManyToTargetDay(
    inputs: WordInput[],
    onProgress?: (progress: WordFillProgress) => void,
    mode?: WordAddMode,
  ) {
    const withReadiness = (result: { added: number; duplicates: number }) => {
      const keys = new Set(inputs.map((input) => wordKey(input.word)));
      const incomplete = listStudyWords().filter(
        (word) => keys.has(wordKey(word.word)) && word.score < 80 && !isDayStudyReady(word),
      ).length;
      return { ...result, incomplete };
    };
    if (bulkTargetDay === null) return withReadiness(await onAddMany(inputs, onProgress, mode));
    const day = bulkTargetDay;
    const alreadyInDay = new Set(
      daily.plan.groups[day - 1]?.words.map((word) => wordKey(word.word)) ?? [],
    );
    const requested = new Set(
      inputs.map((input) => wordKey(input.word)).filter((key) => !alreadyInDay.has(key)),
    );
    const freeSlots = Math.max(0, 40 - (daily.plan.groups[day - 1]?.total ?? 0));
    if (requested.size > freeSlots) {
      throw new Error(`${day}. günde ${freeSlots} boş yer var. Lütfen listeyi küçült.`);
    }
    const requestedKeys = new Set(inputs.map((input) => wordKey(input.word)));
    const elsewhere = daily.plan.groups
      .filter((group) => group.day !== day)
      .flatMap((group) => group.words)
      .filter((word) => requestedKeys.has(wordKey(word.word)));
    if (
      elsewhere.length &&
      !window.confirm(
        `${elsewhere.length} mevcut kelime diğer günlerden ${day}. güne taşınacak. Devam edilsin mi?`,
      )
    )
      throw new Error("Günler arası kelime taşıma iptal edildi.");
    if (!accountId) {
      const result = await local.addGuestToDay(inputs, day);
      await onReload();
      return withReadiness(result);
    }
    if (!cloudPlanEnabled)
      throw new Error("Hedef güne kayıt için güncel hesap bağlantısı gerekli.");
    const result = await onAddMany(inputs, onProgress, mode, (prepared) =>
      cloud.importDay(prepared, day),
    );
    await onReload();
    return withReadiness(result);
  }

  async function saveWord(
    input: WordInput,
    onProgress?: (progress: WordFillProgress) => void,
    mode?: WordAddMode,
  ) {
    if (createTargetDay !== null && !accountId) {
      await local.addGuestToDay([input], createTargetDay, true);
      await onReload();
      return;
    }
    if (createTargetDay !== null) {
      if (!cloudPlanEnabled)
        throw new Error("Hedef güne kayıt için güncel hesap bağlantısı gerekli.");
      await onAddMany([input], onProgress, mode, (prepared) =>
        cloud.importDay(prepared, createTargetDay, true),
      );
      await onReload();
      return;
    }
    await onSave(input, onProgress, mode);
  }

  function editWord(word: WordEntry) {
    setCreateTargetDay(null);
    setEditingWord(word);
    setFormOpen(true);
  }

  function addWordToDay(day: number) {
    setCreateTargetDay(day);
    setEditingWord(undefined);
    setFormOpen(true);
  }

  const dayCommands = libraryDayCommands(daily, words, accountId, onNotify, onRemoveMany, t);

  function openCreate() {
    setCreateTargetDay(null);
    setEditingWord(undefined);
    setFormOpen(true);
  }

  function changeFormOpen(open: boolean) {
    setFormOpen(open);
    if (!open && initialCreate) onInitialCreateHandled?.();
  }

  async function deleteWord(word: WordEntry) {
    if (!window.confirm(t("library.confirmDelete", { word: word.word }))) return;
    try {
      await onRemove(word.id);
      selection.remove(word.id);
      onNotify.success(t("library.deleted"));
    } catch (error) {
      onNotify.error(error instanceof Error ? error.message : t("library.deleteFailed"));
    }
  }

  async function deleteSelection() {
    if (
      !selection.selectedIds.length ||
      !window.confirm(t("library.confirmDeleteSelected", { count: selection.selectedIds.length }))
    )
      return;
    try {
      await onRemoveMany(selection.selectedIds);
      selection.clear();
      onNotify.success(t("library.selectedDeleted"));
    } catch (error) {
      onNotify.error(error instanceof Error ? error.message : t("library.selectedDeleteFailed"));
    }
  }

  async function deleteAll() {
    if (!words.length || !window.confirm(t("library.confirmDeleteAll"))) return;
    try {
      await onRemoveMany(words.map((word) => word.id));
      selection.clear();
      onNotify.success(t("library.allDeleted"));
    } catch (error) {
      onNotify.error(error instanceof Error ? error.message : t("library.allDeleteFailed"));
    }
  }

  return {
    formOpen,
    bulkOpen,
    setBulkOpen,
    bulkTargetDay,
    setBulkTargetDay,
    editingWord,
    createTargetDay,
    bulkAddForDay,
    openGeneralBulk,
    bulkAssignWordIds,
    addManyToTargetDay,
    saveWord,
    editWord,
    addWordToDay,
    ...dayCommands,
    openCreate,
    changeFormOpen,
    deleteWord,
    deleteSelection,
    deleteAll,
  };
}
