import type { WordEntry, WordInput } from "@yds-atlas/shared";
import { BookOpen } from "lucide-react";
import { WordImportReview } from "@/features/word-library/components/word-import-review";
import { starterVocabulary } from "@/features/word-library/data/starter-vocabulary";
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
}) {
  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        <span className="grid size-8 place-items-center rounded-full bg-orange-50 text-sm font-bold text-orange-700">
          1
        </span>
        <h2 className="text-lg font-semibold text-atlas-navy">
          Kelimelerini nereden seçmek istersin?
        </h2>
      </div>
      <Tabs
        id="source-selection"
        value={source}
        onValueChange={(value) => onSourceChange(value as SetupSource)}
      >
        <TabsList
          id="task-sources"
          className="grid h-auto min-h-12 w-full grid-cols-3 items-stretch gap-1 p-1"
        >
          <TabsTrigger
            className="min-h-10 min-w-0 whitespace-normal px-1 text-xs sm:text-sm"
            value="starter"
          >
            Hazır liste
          </TabsTrigger>
          <TabsTrigger className="min-h-10 min-w-0 px-1 text-xs sm:text-sm" value="library">
            Kütüphanem
          </TabsTrigger>
          <TabsTrigger className="min-h-10 min-w-0 px-1 text-xs sm:text-sm" value="own">
            Kendi listem
          </TabsTrigger>
        </TabsList>
        <div id="source-information" className="mt-4 min-w-0">
          <TabsContent value="starter" className="space-y-4">
            <div className="rounded-xl bg-blue-50 p-4">
              <p className="flex items-center gap-2 font-semibold text-atlas-navy">
                <BookOpen size={18} /> Kelimeler hazır, sen başlayabilirsin.
              </p>
              <p className="mt-2 text-sm leading-7 text-slate-600">
                20 kelime, Türkçe anlamları ve çevrilmiş örnekleriyle hazır. Başlayınca yeni
                kelimeler kütüphanene eklenir.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {starterVocabulary.slice(0, 8).map((word) => (
                <Badge className="px-2.5 py-1 text-xs" variant="outline" key={word.word}>
                  {word.word}
                </Badge>
              ))}
              <Badge variant="secondary">+12 kelime</Badge>
            </div>
          </TabsContent>
          <TabsContent value="library" className="space-y-4">
            <p className="text-sm leading-7 text-slate-600">
              <strong className="text-atlas-navy">{ready.length} kelimen</strong> çalışmaya hazır.
              Anlamı ve en az beş örnek cümlesi bulunan, henüz öğrenme aşamasındaki kelimelerden
              seçilir.
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
              <BookOpen size={16} /> Kütüphanemi düzenle
            </Button>
          </TabsContent>
          <TabsContent value="own">
            <WordImportReview
              key={guideActive ? "guide" : "real"}
              demo={guideActive}
              busy={busy}
              label="Listeyi kullan"
              onReviewed={onReviewed}
              onCorrected={onCorrected}
              onAccept={onImport}
            />
            {ownKeys.length > 0 && (
              <div className="mt-4 rounded-lg bg-blue-50 p-3 text-sm leading-6 text-slate-600">
                {ownKeys.length} kelime incelendi; {candidates.length} kelime hazır. Eksik anlam ve
                örnekleri kütüphanenden tamamlayabilirsin.
              </div>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </section>
  );
}
