import type { AssessmentAction, WordEntry, WordInput } from "@yds-atlas/shared";
import { ArrowLeft, GraduationCap, Pause, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { recordDailyProgress } from "@/features/dashboard/model/daily-progress";
import { starterVocabulary } from "@/features/word-library/data/starter-vocabulary";
import { type DailyGroupPreset, isDayStudyReady } from "@/features/word-library/model/daily-groups";
import type { WordFillProgress } from "@/features/word-library/model/prepare-word-inputs";
import type { Notify } from "@/shared/lib/notify";
import { getStorageScope } from "@/shared/lib/storage-scope";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui/dialog";
import { GuidedTour } from "@/shared/ui/guided-tour";
import {
  advance,
  createSession,
  currentWord,
  recordAnswer,
  resultScore,
  setConfidence,
} from "../model/game-engine";
import type { GameSession } from "../model/game-session";
import { persistSession, readSession } from "../model/game-storage";
import { continueMatching, retryMatching, selectMatching } from "../model/matching-engine";
import { playGuide } from "../model/tutorial-steps";
import { GamePlay } from "./game-play";
import { GameProgress } from "./game-progress";
import { GameResults } from "./game-results";
import { GameSetup } from "./game-setup";

interface LearningGamePageProps {
  words: WordEntry[];
  onBack: () => void;
  onNotify: Notify;
  onOpenLibrary: () => void;
  onAddMany: (
    words: WordInput[],
    onProgress?: (progress: WordFillProgress) => void,
  ) => Promise<{ added: number; duplicates: number }>;
  onApplyScores: (updates: { id: string; score: number }[]) => Promise<void>;
  listWords: () => WordEntry[];
  preset?: DailyGroupPreset | null;
  onPresetHandled?: () => void;
  onPersistSession?: (session: GameSession) => Promise<void>;
  onCompleteSession?: (session: GameSession) => Promise<{ practiceOnly: boolean }>;
}

function createTask(words: WordEntry[], batch: 5 | 10, account: boolean): GameSession {
  const session = createSession(words, batch);
  return account ? { ...session, assessmentActions: [] } : session;
}
export function LearningGamePage({
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
  const { t } = useTranslation();
  const presetWords = useMemo(() => {
    if (!preset) return [];
    const ids = new Set(preset.wordIds);
    return words.filter((word) => ids.has(word.id) && isDayStudyReady(word));
  }, [preset, words]);
  const [saved, setSaved] = useState(readSession);
  const hasUnfinished = !!saved && !saved.saved;
  const [session, setSession] = useState<GameSession | null>(() =>
    !hasUnfinished && preset && presetWords.length
      ? { ...createTask(presetWords, 5, !!onPersistSession), day: preset.day }
      : null,
  );
  const [discarding, setDiscarding] = useState(false);
  const [discardTarget, setDiscardTarget] = useState<string | null>(null);
  const [discardError, setDiscardError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState(false);
  const [retryingSync, setRetryingSync] = useState(false);
  const [guide, setGuide] = useState(0);
  const saveLock = useRef(false);
  const alive = useRef(true);
  const storageOwner = useRef(getStorageScope());
  const presetHandled = useRef(false);
  const initialSavedId = useRef(saved?.id);
  const discardLock = useRef(false);
  const discardTrigger = useRef<HTMLElement | null>(null);
  // A day-based session must be saved as soon as it starts, not only after the
  // first answer. Otherwise reload/close loses the selected day's progress.
  const initialDaySession = useRef(session);
  useEffect(() => {
    const first = initialDaySession.current;
    if (!first) return;
    initialDaySession.current = null;
    try {
      persistSession(first);
      setSaved(first);
    } catch (reason) {
      onNotify.error(reason instanceof Error ? reason.message : "Çalışma oturumu kaydedilemedi.");
      return;
    }
    if (onPersistSession) {
      void onPersistSession(first).catch((reason) => {
        if (!alive.current || getStorageScope() !== storageOwner.current) return;
        setSyncError(true);
        onNotify.error(reason instanceof Error ? reason.message : "Oturum buluta kaydedilemedi.");
      });
    }
  }, [onNotify, onPersistSession]);
  useEffect(() => {
    alive.current = true;
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
  const activeWordId = phase?.endsWith("matching") ? undefined : session?.queue[0];
  const isTutorial = !!session?.tutorial;
  const scrollKey = `${phase}:${activeWordId ?? ""}`;
  const lastScrollKey = useRef<string | null>(null);
  useEffect(() => {
    if (lastScrollKey.current === scrollKey) return;
    lastScrollKey.current = scrollKey;
    if (!isTutorial) window.scrollTo({ top: 0 });
  }, [scrollKey, isTutorial]);

  async function commit(next: GameSession, action?: AssessmentAction) {
    if (next === session) return;
    if (action && next.assessmentActions)
      next = { ...next, assessmentActions: [...next.assessmentActions, action] };
    try {
      if (!next.tutorial) {
        persistSession(next);
        setSaved(next);
      }
      setSession(next);
      setError("");
      if (!next.tutorial && onPersistSession) {
        await onPersistSession(next);
        if (alive.current && getStorageScope() === storageOwner.current) setSyncError(false);
      }
    } catch (error) {
      if (alive.current && getStorageScope() === storageOwner.current) {
        setSyncError(true);
        onNotify.error(error instanceof Error ? error.message : "İlerlemen kaydedilemedi.");
      }
    }
  }
  async function retrySync() {
    if (!session || !onPersistSession || retryingSync) return;
    setRetryingSync(true);
    try {
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
    setDiscardTarget(saved.id);
  }

  async function discardSavedTask() {
    if (!discardTarget || discardLock.current || saveLock.current) return;
    const current = readSession();
    if (!current || current.id !== discardTarget || current.saved || current.phase === "complete") {
      setDiscardError(t("taskIntro.discardChanged"));
      return;
    }
    discardLock.current = true;
    setDiscarding(true);
    setDiscardError("");
    try {
      if (onPersistSession) await onPersistSession({ ...current, discarded: true });
      if (!alive.current || getStorageScope() !== storageOwner.current) return;
      if (readSession()?.id !== current.id) {
        setDiscardError(t("taskIntro.discardChanged"));
        return;
      }
      persistSession(null);
      setSaved(null);
      setSession(null);
      setSyncError(false);
      setDiscardTarget(null);
      onNotify.success(t("taskIntro.discarded"));
      if (preset && presetWords.length) {
        await commit({ ...createTask(presetWords, 5, !!onPersistSession), day: preset.day });
      }
    } catch {
      if (alive.current && getStorageScope() === storageOwner.current)
        setDiscardError(t("taskIntro.discardFailed"));
    } finally {
      discardLock.current = false;
      if (alive.current) setDiscarding(false);
    }
  }
  function tutorial() {
    const base = starterVocabulary.find((word) => word.word === "Expand");
    if (!base) return;
    const now = new Date().toISOString();
    const word: WordEntry = {
      ...base,
      id: "tutorial-expand",
      createdAt: now,
      updatedAt: now,
    };
    setGuide(0);
    commit(createSession([word], 5, true));
  }
  const beginTutorialFromHelp = useEffectEvent(() => {
    sessionStorage.removeItem("atlas:game-setup-help");
    tutorial();
  });
  useEffect(() => {
    if (!session) return;
    const begin = () => beginTutorialFromHelp();
    window.addEventListener("atlas:help-request", begin);
    if (sessionStorage.getItem("atlas:game-setup-help") === "1") begin();
    return () => window.removeEventListener("atlas:help-request", begin);
  }, [session]);
  function nextGuide() {
    setGuide((index) => Math.min(index + 1, playGuide.length - 1));
  }
  const saveResults = useCallback(async () => {
    if (!session || session.tutorial || session.saved || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setError("");
    try {
      const existing = new Set(words.map((word) => word.id));
      const results = session.words
        .filter((word) => existing.has(word.id))
        .map((word) => ({ id: word.id, score: resultScore(session, word) }));
      let practiceOnly = false;
      if (onCompleteSession) ({ practiceOnly } = await onCompleteSession(session));
      else {
        await onApplyScores(results);
        recordDailyProgress(results.map((result) => result.id));
      }
      if (!alive.current || getStorageScope() !== storageOwner.current) return;
      const next = { ...session, saved: true };
      persistSession(next);
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
  }, [session, words, onApplyScores, onNotify, onCompleteSession, t]);
  useEffect(() => {
    if (phase !== "complete") return;
    const timer = window.setTimeout(() => {
      void saveResults();
    }, 0);
    return () => clearTimeout(timer);
  }, [phase, saveResults]);
  const discardDialog = (
    <Dialog
      open={discardTarget !== null}
      onOpenChange={(open) => !open && !discarding && setDiscardTarget(null)}
    >
      <DialogContent
        role="alertdialog"
        className="max-w-md bg-card p-5 text-foreground sm:p-6"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (discardTrigger.current?.isConnected) discardTrigger.current.focus();
          else document.querySelector<HTMLElement>("#task-intro button, #game-exit")?.focus();
        }}
      >
        <div className="pr-9">
          <DialogTitle className="mt-0 text-foreground">{t("taskIntro.discardTitle")}</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-muted-foreground">
            {t("taskIntro.confirmDiscard")}
          </DialogDescription>
        </div>
        {discardError && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {discardError}
          </p>
        )}
        <div className="mt-5 grid gap-2 sm:flex sm:justify-end">
          <Button variant="outline" disabled={discarding} onClick={() => setDiscardTarget(null)}>
            {t("taskIntro.discardCancel")}
          </Button>
          <Button
            variant="destructive"
            className="border border-destructive/40 bg-destructive/10"
            disabled={discarding}
            onClick={() => void discardSavedTask()}
          >
            {t(discarding ? "taskIntro.discarding" : "taskIntro.discardConfirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
  if (!session && preset)
    return (
      <section className="mx-auto max-w-4xl space-y-3 rounded-xl border border-border bg-card p-5">
        <h1 className="text-xl font-semibold text-foreground">
          {t("library.daily.manage.dayGameTitle", { day: preset.day })}
        </h1>
        {saved && !saved.saved && (
          <>
            <p className="text-sm text-muted-foreground">{t("taskIntro.chooseSavedTask")}</p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={discarding} onClick={() => setSession(saved)}>
                {t("taskIntro.continue")}
              </Button>
              {saved.phase !== "complete" && (
                <Button variant="outline" disabled={discarding} onClick={requestDiscard}>
                  {t(discarding ? "taskIntro.discarding" : "taskIntro.discard")}
                </Button>
              )}
            </div>
          </>
        )}
        {(!saved || saved.saved) && presetWords.length > 0 && (
          <Button
            onClick={() =>
              void commit({ ...createTask(presetWords, 5, !!onPersistSession), day: preset.day })
            }
          >
            {t("library.daily.manage.study")}
          </Button>
        )}
        {!presetWords.length && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("library.daily.manage.dayGameEmpty")}
          </p>
        )}
        <Button variant="ghost" onClick={onOpenLibrary}>
          <ArrowLeft size={17} /> {t("library.daily.manage.dayGameBack")}
        </Button>
        {discardDialog}
      </section>
    );
  if (!session)
    return (
      <>
        <GameSetup
          words={words}
          saved={saved}
          listWords={listWords}
          onStart={(chosen, batch) => commit(createTask(chosen, batch, !!onPersistSession))}
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
        practiceOnly={Boolean(onCompleteSession && !session.assessmentActions)}
        saving={saving}
        error={error}
        onSave={() => void saveResults()}
        onBack={() => {
          setSession(null);
          setSaved(readSession());
        }}
      />
    );
  const word = currentWord(session);
  const attempt = session.attempts[`${session.phase}:${word?.id}`] ?? 0;
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      {session.tutorial ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4">
          <GraduationCap size={23} className="text-orange-600" />
          <div className="min-w-0 flex-1">
            <strong className="block text-sm text-atlas-navy">
              OYUN REHBERİ · {guide + 1}/{playGuide.length}
            </strong>
            <span className="text-xs text-slate-500">
              Deneme alanındasın. Gerçek kelimelerin ve günlük serin etkilenmez.
            </span>
          </div>
          <Button id="tutorial-restart" variant="ghost" size="sm" onClick={tutorial}>
            <RotateCcw size={15} /> Baştan
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button id="game-exit" variant="ghost" onClick={onBack}>
            <ArrowLeft size={17} /> Ana sayfa
          </Button>
          <span className="text-sm font-semibold text-atlas-navy">
            {session.day
              ? t("library.daily.manage.dayGameTitle", { day: session.day })
              : t("taskIntro.title")}
          </span>
          <Button
            variant="outline"
            onClick={() => {
              setSession(null);
              onNotify.success("Görevin kaydedildi. Hazır olduğunda devam edebilirsin.");
            }}
          >
            <Pause size={17} /> Ara ver
          </Button>
          <Button
            variant="ghost"
            onClick={requestDiscard}
            disabled={!saved || saved.phase === "complete"}
          >
            {t("taskIntro.discard")}
          </Button>
        </div>
      )}
      {syncError && !session.tutorial && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
        >
          <span>İlerlemen bu cihazda saklanıyor, ancak buluta kaydedilemedi.</span>
          <Button
            variant="outline"
            size="sm"
            disabled={retryingSync}
            onClick={() => void retrySync()}
          >
            {retryingSync ? "Kaydediliyor…" : "Tekrar dene"}
          </Button>
        </div>
      )}
      <GameProgress session={session} />
      <GamePlay
        key={`${session.id}:${session.phase}:${session.groupIndex}:${session.phase.endsWith("matching") ? "matching" : word?.id}:${attempt}`}
        session={session}
        onFlip={(back) => {
          const step = playGuide[guide].id;
          if (
            session.tutorial &&
            ((back && ["flip", "turn-back"].includes(step)) || (!back && step === "turn-front"))
          )
            nextGuide();
        }}
        onPronounce={() => {
          if (session.tutorial && playGuide[guide].id === "pronounce") nextGuide();
        }}
        onMatch={(side, id) => {
          const next = selectMatching(session, side, id);
          commit(next, { type: "match", side, id });
          const step = playGuide[guide].id;
          if (
            session.tutorial &&
            next !== session &&
            ((step === "matching-left" && next.matching?.selectedLeft) ||
              (step === "matching-right" && next.matching?.feedback?.correct))
          )
            nextGuide();
        }}
        onMatchRetry={() => commit(retryMatching(session), { type: "match-retry" })}
        onMatchNext={() => {
          commit(continueMatching(session), { type: "match-next" });
          if (session.tutorial) nextGuide();
        }}
        onRemember={(remembered) => {
          commit(advance(session, remembered), { type: "advance" });
          if (session.tutorial) nextGuide();
        }}
        onAnswer={(choice) => {
          commit(recordAnswer(session, choice), { type: "answer", choice });
          if (session.tutorial) nextGuide();
        }}
        onConfidence={(value) => {
          commit(setConfidence(session, value), { type: "confidence", value });
          if (session.tutorial) nextGuide();
        }}
        onNext={() => {
          commit(advance(session), { type: "advance" });
          if (session.tutorial) nextGuide();
        }}
      />
      {session.tutorial && (
        <GuidedTour
          step={playGuide[guide]}
          index={guide}
          total={playGuide.length}
          name="Oyun rehberi"
          onNext={nextGuide}
          onExit={() => setSession(null)}
        />
      )}
      {discardDialog}
    </div>
  );
}
