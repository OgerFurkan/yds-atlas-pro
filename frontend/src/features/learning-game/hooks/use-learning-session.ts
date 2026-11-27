import type { AssessmentAction, WordEntry } from "@yds-atlas/shared";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { withLocalWordWrite } from "@/features/word-library/library-storage";
import { getStorageScope } from "@/shared/lib/storage-scope";
import { completeLearningTask } from "../model/complete-learning-task";
import type { GameSession } from "../model/game-session";
import { persistSessionChange, readSession, sameSession } from "../model/game-storage";
import { createTask, type LearningGamePageProps } from "../model/learning-task";

export function useLearningSession({
  onlineOwner,
  preset,
  presetWords,
  onPersistSession,
  onPresetHandled,
  onNotify,
  onCompleteSession,
  onApplyScores,
}: Pick<
  LearningGamePageProps,
  | "onlineOwner"
  | "preset"
  | "onPersistSession"
  | "onPresetHandled"
  | "onNotify"
  | "onCompleteSession"
  | "onApplyScores"
> & { presetWords: WordEntry[] }) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState(readSession);
  const [session, setSession] = useState<GameSession | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [discardTarget, setDiscardTarget] = useState<GameSession | null>(null);
  const [discardError, setDiscardError] = useState("");
  const [saving, setSaving] = useState(false);
  const [practiceResult, setPracticeResult] = useState(false);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState(false);
  const [retryingSync, setRetryingSync] = useState(false);
  const saveLock = useRef(false);
  const alive = useRef(true);
  const storageOwner = useRef(getStorageScope());
  const presetHandled = useRef(false);
  const initialSavedId = useRef(saved?.id);
  const discardLock = useRef(false);
  const discardTrigger = useRef<HTMLElement | null>(null);
  // A day-based session must be saved as soon as it starts, not only after the
  // first answer. Otherwise reload/close loses the selected day's progress.
  const [initialDaySession] = useState(() =>
    !onlineOwner && (!saved || saved.saved) && preset && presetWords.length
      ? { ...createTask(presetWords, 5, !!onPersistSession), day: preset.day }
      : null,
  );
  const startDay = useEffectEvent(() => {
    if (initialDaySession) void commit(initialDaySession);
  });
  const startRequested = useRef(false);
  useEffect(() => {
    alive.current = true;
    if (!startRequested.current) {
      startRequested.current = true;
      startDay();
    }
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (
      !preset ||
      presetHandled.current ||
      !session ||
      session.day !== preset.day ||
      session.id === initialSavedId.current
    )
      return;
    presetHandled.current = true;
    onPresetHandled?.();
  }, [preset, onPresetHandled, session]);
  const phase = session?.phase;
  async function commit(next: GameSession, action?: AssessmentAction, expected = session ?? saved) {
    if (next === session) return;
    if (action && next.assessmentActions)
      next = { ...next, assessmentActions: [...next.assessmentActions, action] };
    if (!next.tutorial) {
      try {
        await withLocalWordWrite(() => {
          if (!alive.current) throw new Error("Oturum değişti.");
          persistSessionChange(next, expected);
        });
        if (!alive.current) return;
        setSaved(next);
      } catch (error) {
        if (alive.current && getStorageScope() === storageOwner.current)
          onNotify.error(
            error instanceof Error ? error.message : "Çalışma bu cihaza kaydedilemedi.",
          );
        return;
      }
    }
    setSession(next);
    setError("");
    if (!next.tutorial && onPersistSession && !next.localPractice) {
      try {
        await onPersistSession(next);
        if (alive.current && getStorageScope() === storageOwner.current) setSyncError(false);
      } catch (error) {
        if (alive.current && getStorageScope() === storageOwner.current) {
          setSyncError(true);
          onNotify.error(error instanceof Error ? error.message : "İlerlemen kaydedilemedi.");
        }
      }
    }
  }
  async function retrySync() {
    if (!session || !onPersistSession || retryingSync) return;
    setRetryingSync(true);
    try {
      if (!sameSession(readSession(), session)) throw new Error(t("taskIntro.discardChanged"));
      await onPersistSession(session);
      if (alive.current && getStorageScope() === storageOwner.current) setSyncError(false);
    } catch (error) {
      if (alive.current && getStorageScope() === storageOwner.current)
        onNotify.error(error instanceof Error ? error.message : "İlerlemen kaydedilemedi.");
    } finally {
      if (alive.current) setRetryingSync(false);
    }
  }
  function requestDiscard() {
    if (!saved || saved.saved || saved.phase === "complete") return;
    discardTrigger.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDiscardError("");
    setDiscardTarget(saved);
  }

  async function discardSavedTask() {
    if (!discardTarget || discardLock.current || saveLock.current) return;
    const current = readSession();
    if (
      !current ||
      !sameSession(current, discardTarget) ||
      current.saved ||
      current.phase === "complete"
    ) {
      setSaved(current);
      setDiscardError(t("taskIntro.discardChanged"));
      return;
    }
    discardLock.current = true;
    setDiscarding(true);
    setDiscardError("");
    try {
      if (onPersistSession && !current.localPractice)
        await onPersistSession({ ...current, discarded: true });
      if (!alive.current || getStorageScope() !== storageOwner.current) return;
      await withLocalWordWrite(() => persistSessionChange(null, current));
      setSaved(null);
      setSession(null);
      setSyncError(false);
      setDiscardTarget(null);
      onNotify.success(t("taskIntro.discarded"));
      if (preset && presetWords.length) {
        await commit(
          { ...createTask(presetWords, 5, !!onPersistSession), day: preset.day },
          undefined,
          null,
        );
      }
    } catch {
      if (alive.current && getStorageScope() === storageOwner.current)
        setDiscardError(t("taskIntro.discardFailed"));
    } finally {
      discardLock.current = false;
      if (alive.current) setDiscarding(false);
    }
  }
  const saveResults = useCallback(async () => {
    if (!session || session.tutorial || session.saved || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setError("");
    try {
      const practiceOnly = await completeLearningTask(session, onCompleteSession, onApplyScores);
      if (!alive.current || getStorageScope() !== storageOwner.current) return;
      setPracticeResult(practiceOnly);
      const next = { ...session, saved: true };
      if (onCompleteSession || session.localPractice)
        await withLocalWordWrite(() => persistSessionChange(next, session));
      setSaved(next);
      setSession(next);
      onNotify.success(
        practiceOnly
          ? t("game.practiceSaved")
          : "Günlük görevin tamamlandı. Kelime grupların ve ilerlemen güncellendi.",
      );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Sonuçlar kaydedilemedi. Tekrar deneyebilirsin.",
      );
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }, [session, onApplyScores, onNotify, onCompleteSession, t]);
  useEffect(() => {
    if (phase !== "complete") return;
    const timer = window.setTimeout(() => {
      void saveResults();
    }, 0);
    return () => clearTimeout(timer);
  }, [phase, saveResults]);
  return {
    session,
    saved,
    discarding,
    discardTarget,
    discardError,
    discardTrigger,
    saving,
    practiceResult,
    error,
    syncError,
    retryingSync,
    commit,
    retrySync,
    requestDiscard,
    discardSavedTask,
    saveResults,
    setDiscardTarget,
    setSession,
    setSaved,
  };
}
