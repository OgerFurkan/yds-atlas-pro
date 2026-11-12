import type { WordEntry, WordInput } from "@yds-atlas/shared";
import { ArrowLeft, GraduationCap, Pause, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { recordDailyProgress } from "@/features/dashboard/model/daily-progress";
import { starterVocabulary } from "@/features/word-library/data/starter-vocabulary";
import type { DailyGroupPreset } from "@/features/word-library/model/daily-groups";
import type { WordFillProgress } from "@/features/word-library/model/prepare-word-inputs";
import type { Notify } from "@/shared/lib/notify";
import { getStorageScope } from "@/shared/lib/storage-scope";
import { Button } from "@/shared/ui/button";
import { GuidedTour } from "@/shared/ui/guided-tour";
import {
  advance,
  createSession,
  currentWord,
  isGameReady,
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
  onCompleteSession?: (session: GameSession) => Promise<void>;
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
  const presetWords = useMemo(() => {
    if (!preset) return [];
    const ids = new Set(preset.wordIds);
    return words.filter((word) => ids.has(word.id) && isGameReady(word));
  }, [preset, words]);
  const [startedDay] = useState(preset?.day ?? null);
  const [session, setSession] = useState<GameSession | null>(() =>
    presetWords.length ? createSession(presetWords, 5) : null,
  );
  const [saved, setSaved] = useState(readSession);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState(false);
  const [retryingSync, setRetryingSync] = useState(false);
  const [guide, setGuide] = useState(0);
  const saveLock = useRef(false);
  const alive = useRef(true);
  const storageOwner = useRef(getStorageScope());
  const presetHandled = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!preset || presetHandled.current) return;
    presetHandled.current = true;
    if (!presetWords.length) onNotify.error("Bu grupta çalışılabilecek hazır kelime kalmadı.");
    onPresetHandled?.();
  }, [preset, presetWords.length, onNotify, onPresetHandled]);
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

  async function commit(next: GameSession) {
    if (next === session) return;
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
      if (onCompleteSession) await onCompleteSession(session);
      else {
        await onApplyScores(results);
        recordDailyProgress(results.map((result) => result.id));
      }
      if (!alive.current || getStorageScope() !== storageOwner.current) return;
      const next = { ...session, saved: true };
      persistSession(next);
      setSaved(next);
      setSession(next);
      onNotify.success("Günlük görevin tamamlandı. Kelime grupların ve ilerlemen güncellendi.");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Sonuçlar kaydedilemedi. Tekrar deneyebilirsin.",
      );
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }, [session, words, onApplyScores, onNotify, onCompleteSession]);
  useEffect(() => {
    if (phase !== "complete") return;
    const timer = window.setTimeout(() => {
      void saveResults();
    }, 0);
    return () => clearTimeout(timer);
  }, [phase, saveResults]);
  if (!session)
    return (
      <GameSetup
        words={words}
        saved={saved}
        listWords={listWords}
        onStart={(chosen, batch) => commit(createSession(chosen, batch))}
        onResume={() => {
          if (saved) setSession(saved);
        }}
        onTutorial={tutorial}
        onAddMany={onAddMany}
        onOpenLibrary={onOpenLibrary}
      />
    );
  if (session.phase === "complete")
    return (
      <GameResults
        session={session}
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
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={17} /> Ana sayfa
          </Button>
          <span className="hidden text-sm font-semibold text-atlas-navy sm:inline">
            {startedDay ? `Gün ${startedDay} · Günlük Plan` : "Günlük Görev"}
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
          commit(next);
          const step = playGuide[guide].id;
          if (
            session.tutorial &&
            next !== session &&
            ((step === "matching-left" && next.matching?.selectedLeft) ||
              (step === "matching-right" && next.matching?.feedback?.correct))
          )
            nextGuide();
        }}
        onMatchRetry={() => commit(retryMatching(session))}
        onMatchNext={() => {
          commit(continueMatching(session));
          if (session.tutorial) nextGuide();
        }}
        onRemember={(remembered) => {
          commit(advance(session, remembered));
          if (session.tutorial) nextGuide();
        }}
        onAnswer={(choice) => {
          commit(recordAnswer(session, choice));
          if (session.tutorial) nextGuide();
        }}
        onConfidence={(value) => {
          commit(setConfidence(session, value));
          if (session.tutorial) nextGuide();
        }}
        onNext={() => {
          commit(advance(session));
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
    </div>
  );
}
