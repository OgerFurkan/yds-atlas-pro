import type { WordEntry, WordInput } from "@yds-atlas/shared";
import { useState } from "react";
import { dailyGoal } from "@/features/dashboard/model/daily-progress";
import { wordKey } from "@/features/word-library/model/word-normalization";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Card, CardContent } from "@/shared/ui/card";
import { GuidedTour } from "@/shared/ui/guided-tour";
import { useSetupGuide } from "../hooks/use-setup-guide";
import { isGameReady } from "../model/game-engine";
import type { GameSession } from "../model/game-session";
import {
  alignChosenWords,
  type SetupSource,
  selectTaskWords,
  setupCandidates,
} from "../model/game-setup";
import { setupGuide } from "../model/tutorial-steps";
import { SetupIntro } from "./setup-intro";
import { SetupSourcePicker } from "./setup-source-picker";
import { SetupSummary } from "./setup-summary";
import { SetupTaskSettings } from "./setup-task-settings";

export function GameSetup({
  words,
  saved,
  listWords,
  onStart,
  onResume,
  onTutorial,
  onAddMany,
  onOpenLibrary,
}: {
  words: WordEntry[];
  saved: GameSession | null;
  listWords: () => WordEntry[];
  onStart: (words: WordEntry[], batch: 5 | 10) => void | Promise<void>;
  onResume: () => void;
  onTutorial: () => void;
  onOpenLibrary: () => void;
  onAddMany: (words: WordInput[]) => Promise<{ added: number; duplicates: number }>;
}) {
  const [source, setSource] = useState<SetupSource>("starter");
  const [target, setTarget] = useState(dailyGoal);
  const [batch, setBatch] = useState<5 | 10>(5);
  const [ownKeys, setOwnKeys] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const {
    guide,
    start: startGuide,
    finish,
    next,
    goTo,
  } = useSetupGuide({
    onReset: () => {
      setSource("starter");
      setBatch(5);
      setTarget(dailyGoal());
    },
    onSourceChange: setSource,
  });

  const ready = words.filter(isGameReady);
  const candidates = setupCandidates(words, source, ownKeys);

  function changeSource(next: SetupSource) {
    setSource(next);
    setError("");
  }

  function changeBatch(next: 5 | 10) {
    setBatch(next);
    if (guide === 9 && next === 10) goTo(10);
  }

  async function importOwn(names: string[]) {
    if (guide !== null) {
      setSource("starter");
      goTo(8);
      return;
    }
    setBusy(true);
    try {
      await onAddMany(names.map((word) => ({ word })));
      setOwnKeys(names.map(wordKey));
    } finally {
      setBusy(false);
    }
  }

  async function start(short = false) {
    if (guide !== null) return;
    setBusy(true);
    setError("");
    try {
      const selected = selectTaskWords(candidates, target, short);
      if (!selected.length) return;
      if (source === "starter") await onAddMany(selected);
      const chosen = alignChosenWords(selected, listWords());
      if (chosen.length !== selected.length)
        throw new Error(
          "Bazı kelimelerin bilgileri eksik. Kütüphaneden anlamlarını ve en az beş örnek cümlesini tamamla.",
        );
      await onStart(chosen, batch);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Görev başlatılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <SetupIntro
        saved={saved}
        guideActive={guide !== null}
        onStartGuide={startGuide}
        onTutorial={onTutorial}
        onResume={onResume}
      />
      <div
        id="task-setup-panels"
        className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_300px]"
      >
        <Card id="task-configuration" className="min-w-0">
          <CardContent className="flex h-full flex-col gap-6 p-5 sm:p-7">
            <SetupSourcePicker
              source={source}
              onSourceChange={changeSource}
              ready={ready}
              candidates={candidates}
              ownKeys={ownKeys}
              busy={busy}
              guideActive={guide !== null}
              onOpenLibrary={onOpenLibrary}
              onReviewed={() => {
                if (guide === 5) goTo(6);
              }}
              onCorrected={() => {
                if (guide === 6) goTo(7);
              }}
              onImport={importOwn}
            />
            <SetupTaskSettings
              target={target}
              onTargetChange={setTarget}
              batch={batch}
              onBatchChange={changeBatch}
            />
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
        <SetupSummary
          target={target}
          candidateCount={candidates.length}
          batch={batch}
          busy={busy}
          saved={saved}
          onStart={(short) => void start(short)}
        />
      </div>
      {guide !== null && (
        <GuidedTour
          step={setupGuide[guide]}
          index={guide}
          total={setupGuide.length}
          name="Hazırlık rehberi"
          onNext={next}
          onExit={finish}
        />
      )}
    </div>
  );
}
