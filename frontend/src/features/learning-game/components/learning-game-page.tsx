import { useMemo } from "react";
import { isDayStudyReady } from "@/features/word-library/model/daily-groups";
import { Button } from "@/shared/ui/button";
import { useLearningSession } from "../hooks/use-learning-session";
import { useLearningTutorial } from "../hooks/use-learning-tutorial";
import { useOnlineAssessment } from "../hooks/use-online-assessment";
import { readSession } from "../model/game-storage";
import { createTask, type LearningGamePageProps } from "../model/learning-task";
import { DayTaskStart } from "./day-task-start";
import { GameResults } from "./game-results";
import { GameSetup } from "./game-setup";
import { LocalGamePlay } from "./local-game-play";
import { OnlineAssessmentEntry } from "./online-assessment-entry";
import { TaskDiscardDialog } from "./task-discard-dialog";

export function LearningGamePage({
  onlineOwner,
  onOnlineFinished,
  words,
  onBack,
  onNotify,
  onOpenLibrary,
  onAddMany,
  onApplyScores,
  listWords,
  preset,
  onPresetHandled,
  onPersistSession,
  onCompleteSession,
}: LearningGamePageProps) {
  const online = useOnlineAssessment(onlineOwner);
  const wantsOnline = !!onlineOwner && !online.practice;
  const presetWords = useMemo(() => {
    if (!preset) return [];
    const ids = new Set(preset.wordIds);
    return words.filter((word) => ids.has(word.id) && isDayStudyReady(word));
  }, [preset, words]);

  const {
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
  } = useLearningSession({
    onlineOwner,
    preset,
    presetWords,
    onPersistSession,
    onPresetHandled,
    onNotify,
    onCompleteSession,
    onApplyScores,
  });
  const { tutorial, nextGuide, guide } = useLearningTutorial(session, commit);
  const discardDialog = (
    <TaskDiscardDialog
      open={discardTarget !== null}
      discarding={discarding}
      discardError={discardError}
      discardTrigger={discardTrigger}
      onClose={() => setDiscardTarget(null)}
      onDiscard={() => void discardSavedTask()}
    />
  );

  if (!session && wantsOnline && (online.error || online.view || online.busy))
    return (
      <OnlineAssessmentEntry
        online={online}
        onPresetHandled={onPresetHandled}
        onOnlineFinished={onOnlineFinished}
        onBack={onBack}
        onNotify={onNotify}
      />
    );
  if (!session && preset)
    return (
      <DayTaskStart
        day={preset.day}
        saved={saved}
        discarding={discarding}
        wordCount={presetWords.length}
        onResume={() => setSession(saved)}
        requestDiscard={requestDiscard}
        onStart={() =>
          wantsOnline
            ? void online.start(presetWords, 5, preset.day)
            : void commit({
                ...createTask(presetWords, 5, !!onPersistSession),
                day: preset.day,
                localPractice: online.practice ? true : undefined,
              })
        }
        onOpenLibrary={onOpenLibrary}
        discardDialog={discardDialog}
      />
    );
  if (!session)
    return (
      <>
        {onlineOwner && (
          <Button variant="outline" onClick={() => online.setPractice(!online.practice)}>
            {online.practice ? "Çevrimiçi puanlı değerlendirme" : "Puansız pratik"}
          </Button>
        )}
        <GameSetup
          words={words}
          saved={saved}
          listWords={listWords}
          onStart={(chosen, batch) =>
            wantsOnline
              ? online.start(chosen, batch)
              : commit({
                  ...createTask(chosen, batch, !!onPersistSession && !online.practice),
                  localPractice: online.practice ? true : undefined,
                })
          }
          onResume={() => {
            if (saved) setSession(saved);
          }}
          discarding={discarding}
          onDiscard={requestDiscard}
          onTutorial={tutorial}
          onAddMany={onAddMany}
          onOpenLibrary={onOpenLibrary}
        />
        {discardDialog}
      </>
    );
  if (session.phase === "complete")
    return (
      <GameResults
        session={session}
        practiceOnly={
          !!session.localPractice ||
          !onCompleteSession ||
          !!onlineOwner ||
          practiceResult ||
          !session.assessmentActions
        }
        saving={saving}
        error={error}
        onSave={() => void saveResults()}
        onBack={() => {
          setSession(null);
          setSaved(readSession());
        }}
      />
    );

  return (
    <LocalGamePlay
      session={session}
      saved={saved}
      guide={guide}
      nextGuide={nextGuide}
      tutorial={tutorial}
      onBack={onBack}
      leaveSession={() => setSession(null)}
      onNotify={onNotify}
      requestDiscard={requestDiscard}
      syncError={syncError}
      retryingSync={retryingSync}
      retrySync={retrySync}
      commit={commit}
      discardDialog={discardDialog}
    />
  );
}
