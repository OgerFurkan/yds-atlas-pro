import { getWordGroup, type WordEntry, type WordInput } from "@yds-atlas/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { checkAiHealth, useAiHealth, wordAiAvailability } from "@/shared/hooks/use-ai-health";
import { getStorageScope } from "@/shared/lib/storage-scope";
import { prepareDayStudy } from "../api/day-study-api";
import { type DailyGroup, type DailyPlan, isDayStudyReady } from "../model/daily-groups";
import { dayStudyState } from "../model/day-study-state";

export function useDayStudy({
  plan,
  onStudyGroup,
  onSaveStudyWord,
  listStudyWords,
  studyBlocked,
  accountId,
}: {
  plan: DailyPlan;
  onStudyGroup: (group: DailyGroup) => void;
  onSaveStudyWord: (
    input: WordInput,
    id: string,
    expectedUpdatedAt: string,
    signal?: AbortSignal,
  ) => Promise<WordEntry>;
  listStudyWords: () => WordEntry[];
  studyBlocked: boolean;
  accountId: string | null;
}) {
  const { t } = useTranslation();
  const health = useAiHealth(
    Boolean(accountId) && plan.groups.some((group) => group.total > group.learned + group.playable),
  );
  const availability = wordAiAvailability(health);
  const operation = useRef<AbortController | null>(null);
  const currentPlan = useRef(plan);
  useEffect(() => {
    currentPlan.current = plan;
  }, [plan]);
  useEffect(() => () => operation.current?.abort(), []);
  const [preparation, setPreparation] = useState<{
    day: number;
    phase: "connecting" | "checking" | "generating" | "saving" | "partial" | "cancelled";
    ready: number;
    total: number;
    issue?: string;
  } | null>(null);
  const preparing = preparation !== null && !["partial", "cancelled"].includes(preparation.phase);

  function cancelStudy() {
    if (!operation.current) return;
    operation.current.abort();
    operation.current = null;
    setPreparation((previous) => previous && { ...previous, phase: "cancelled" });
  }

  function stateFor(group: DailyGroup) {
    return dayStudyState(group, availability, Boolean(accountId), studyBlocked);
  }

  async function requestStudy(group: DailyGroup, retry = false) {
    if (operation.current) return;
    if (!retry && group.playable) {
      onStudyGroup(group);
      return;
    }
    if (!accountId || studyBlocked || (!retry && stateFor(group) !== "prepare")) return;
    const incomplete = group.words.filter(
      (word) =>
        getWordGroup(word.score) !== "learned" &&
        !group.playableWords.some((entry) => entry.id === word.id),
    );
    if (!incomplete.length) return;
    const controller = new AbortController();
    operation.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]);
    const total = group.playable + incomplete.length;
    function current() {
      signal.throwIfAborted();
      if (getStorageScope() !== accountId) throw new DOMException("Account changed", "AbortError");
      return currentPlan.current.groups[group.day - 1];
    }
    try {
      setPreparation({ day: group.day, phase: "connecting", ready: group.playable, total });
      const checked = await checkAiHealth();
      current();
      const status = wordAiAvailability(checked);
      if (status !== "available") {
        throw new Error(checked.errorMessage || t(`library.daily.manage.study_state_${status}`));
      }
      const result = await prepareDayStudy(
        incomplete,
        accountId,
        signal,
        async (input, id, revision) => {
          if (!current()?.words.some((word) => word.id === id))
            throw new Error(t("library.daily.manage.studyChanged"));
          return onSaveStudyWord(input, id, revision, signal);
        },
        (phase, prepared) =>
          setPreparation({ day: group.day, phase, ready: group.playable + prepared, total }),
      );
      const latest = current();
      const entries = new Map(listStudyWords().map((word) => [word.id, word]));
      const playableWords = latest.words.flatMap((word) => {
        const updated = entries.get(word.id);
        return updated && isDayStudyReady(updated) ? [updated] : [];
      });
      if (playableWords.length && playableWords.length === latest.total - latest.learned) {
        setPreparation(null);
        onStudyGroup({ ...latest, playable: playableWords.length, playableWords });
      } else {
        setPreparation({
          day: group.day,
          phase: "partial",
          ready: playableWords.length,
          total: latest.total - latest.learned,
          issue: result.issue,
        });
      }
    } catch (error) {
      if (!controller.signal.aborted && getStorageScope() === accountId) {
        const latest = currentPlan.current.groups[group.day - 1];
        setPreparation({
          day: group.day,
          phase: "partial",
          ready: latest.playable,
          total: latest.total - latest.learned,
          issue: signal.aborted
            ? t("library.daily.manage.prepareTimeout")
            : error instanceof Error
              ? error.message
              : undefined,
        });
      }
    } finally {
      if (operation.current === controller) operation.current = null;
    }
  }

  return {
    preparation,
    preparing,
    stateFor,
    healthIssue: health.errorMessage || health.wordIssue?.message,
    cancelStudy,
    requestStudy,
    resetPreparation: () => setPreparation(null),
  };
}
