import type { WordEntry, WordInput } from "@yds-atlas/shared";
import { BookOpen, LoaderCircle, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { WordImportReview } from "@/features/word-library/components/word-import-review";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import type { SetupSource } from "../model/game-setup";

export function SetupSourcePicker({
  source,
  onSourceChange,
  ready,
  candidates,
  ownKeys,
  busy,
  guideActive,
  onOpenLibrary,
  onReviewed,
  onCorrected,
  onImport,
  aiWords,
  onGenerateAi,
}: {
  source: SetupSource;
  onSourceChange: (source: SetupSource) => void;
  ready: WordEntry[];
  candidates: WordInput[];
  ownKeys: string[];
  busy: boolean;
  guideActive: boolean;
  onOpenLibrary: () => void;
  onReviewed: () => void;
  onCorrected: () => void;
  onImport: (names: string[]) => Promise<void>;
  aiWords: WordInput[];
  onGenerateAi: () => void;
}) {
  const { t } = useTranslation();
  const hardCount = candidates.filter((word) => (word.score ?? 0) < 40).length;
  const reviewCount = candidates.length - hardCount;
  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        <span className="grid size-8 place-items-center rounded-full bg-orange-50 text-sm font-bold text-orange-700">
          1
        </span>
        <h2 className="text-lg font-semibold text-atlas-navy">{t("setup.sourceHeading")}</h2>
      </div>
      <Tabs
        id="source-selection"
        value={source}
        onValueChange={(value) => onSourceChange(value as SetupSource)}
      >
        <TabsList
          id="task-sources"
          className="grid h-auto min-h-12 w-full grid-cols-2 sm:grid-cols-4 items-stretch gap-1 p-1"
        >
          <TabsTrigger
            className="min-h-10 min-w-0 whitespace-normal px-1 text-xs sm:text-sm"
            value="starter"
          >
            {t("setup.starter")}
          </TabsTrigger>
          <TabsTrigger className="min-h-10 min-w-0 px-1 text-xs sm:text-sm" value="library">
            {t("setup.library")}
          </TabsTrigger>
          <TabsTrigger className="min-h-10 min-w-0 px-1 text-xs sm:text-sm" value="own">
            {t("setup.own")}
          </TabsTrigger>
          <TabsTrigger className="min-h-10 min-w-0 px-1 text-xs sm:text-sm" value="ai">
            {t("setup.ai")}
          </TabsTrigger>
        </TabsList>
        <div id="source-information" className="mt-4 min-w-0">
          <TabsContent value="starter" className="space-y-4">
            <div className="rounded-xl bg-blue-50 p-4">
              <p className="flex items-center gap-2 font-semibold text-atlas-navy">
                <BookOpen size={18} /> {t("setup.starterTitle")}
              </p>
              <p className="mt-2 text-sm leading-7 text-slate-600">
                {t("setup.starterDescription")}
              </p>
              <p className="mt-2 text-xs font-semibold text-atlas-blue">
                {t("setup.starterGroups", { hard: hardCount, review: reviewCount })}
              </p>
            </div>
            {candidates.length ? (
              <div className="flex flex-wrap gap-2">
                {candidates.slice(0, 8).map((word) => (
                  <Badge className="px-2.5 py-1 text-xs" variant="outline" key={word.word}>
                    {word.word}
                  </Badge>
                ))}
                {candidates.length > 8 && (
                  <Badge variant="secondary">
                    {t("setup.starterAvailable", { count: candidates.length })}
                  </Badge>
                )}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm leading-6 text-slate-600">
                {t("setup.starterEmpty")}
              </p>
            )}
          </TabsContent>
          <TabsContent value="library" className="space-y-4">
            <p className="text-sm leading-7 text-slate-600">
              <strong className="text-atlas-navy">
                {ready.length} {t("setup.ready")}
              </strong>{" "}
              {t("setup.readyDescription")}
            </p>
            {ready.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {ready.slice(0, 12).map((word) => (
                  <Badge key={word.id} variant="outline">
                    {word.word}
                  </Badge>
                ))}
              </div>
            )}
            <Button variant="outline" onClick={onOpenLibrary}>
              <BookOpen size={16} /> {t("setup.editLibrary")}
            </Button>
          </TabsContent>
          <TabsContent value="own">
            <WordImportReview
              key={guideActive ? "guide" : "real"}
              demo={guideActive}
              busy={busy}
              label={t("setup.useList")}
              onReviewed={onReviewed}
              onCorrected={onCorrected}
              onAccept={onImport}
            />
            {ownKeys.length > 0 && (
              <div className="mt-4 rounded-lg bg-blue-50 p-3 text-sm leading-6 text-slate-600">
                {t("setup.reviewed", { count: ownKeys.length, ready: candidates.length })}
              </div>
            )}
          </TabsContent>
          <TabsContent value="ai" className="space-y-4">
            <p className="text-sm leading-6 text-slate-600">{t("setup.aiDescription")}</p>
            <Button variant="outline" disabled={busy || guideActive} onClick={onGenerateAi}>
              {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {busy ? t("setup.generating") : t("setup.generate")}
            </Button>
            {aiWords.length > 0 && (
              <div className="max-h-72 space-y-2 overflow-y-auto" aria-live="polite">
                {aiWords.map((word) => (
                  <details key={word.word} className="rounded-md border p-3 text-sm">
                    <summary className="cursor-pointer font-semibold text-atlas-navy">
                      {word.word} · {word.meanings?.join(" / ")}
                    </summary>
                    <p className="mt-2 text-xs text-slate-600">
                      {word.cefr} · {word.partOfSpeech} · {word.usageNote}
                    </p>
                    <ol className="mt-2 space-y-2 text-xs text-slate-600">
                      {word.examples?.map((example) => (
                        <li key={example.sentence}>
                          <p>{example.sentence}</p>
                          <p>{example.translation}</p>
                        </li>
                      ))}
                    </ol>
                  </details>
                ))}
              </div>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </section>
  );
}
