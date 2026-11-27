import type { AssessmentAction } from "@yds-atlas/shared";
import { ArrowLeft, GraduationCap, Pause, RotateCcw } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Notify } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";
import { GuidedTour } from "@/shared/ui/guided-tour";
import { advance, currentWord, recordAnswer, setConfidence } from "../model/game-engine";
import type { GameSession } from "../model/game-session";
import { continueMatching, retryMatching, selectMatching } from "../model/matching-engine";
import { playGuide } from "../model/tutorial-steps";
import { GamePlay } from "./game-play";
import { GameProgress } from "./game-progress";

export function LocalGamePlay({
  session,
  saved,
  guide,
  nextGuide,
  tutorial,
  onBack,
  leaveSession,
  onNotify,
  requestDiscard,
  syncError,
  retryingSync,
  retrySync,
  commit,
  discardDialog,
}: {
  session: GameSession;
  saved: GameSession | null;
  guide: number;
  nextGuide: () => void;
  tutorial: () => void;
  onBack: () => void;
  leaveSession: () => void;
  onNotify: Notify;
  requestDiscard: () => void;
  syncError: boolean;
  retryingSync: boolean;
  retrySync: () => Promise<void>;
  commit: (next: GameSession, action?: AssessmentAction) => Promise<void>;
  discardDialog: ReactNode;
}) {
  const { t } = useTranslation();
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
              leaveSession();
              if (syncError) onNotify.info("Ara verildi. Bulut kaydı yeniden denenmeli.");
              else onNotify.info("Ara verildi. Hazır olduğunda devam edebilirsin.");
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
          onExit={leaveSession}
        />
      )}
      {discardDialog}
    </div>
  );
}
