import type { WordEntry } from "@yds-atlas/shared";
import { ArrowUpRight, BookOpen, Languages } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { formatWordType } from "../model/word-normalization";
import { PronunciationButtons } from "./pronunciation-buttons";
import { WordExample } from "./word-example";
import { WordStatus } from "./word-status";

export function WordDetails({ word }: { word: WordEntry }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const cambridge = `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(word.word.toLowerCase())}`;
  return (
    <>
      <Button
        variant="link"
        size="sm"
        className="min-h-8 justify-start px-0 text-xs"
        onClick={() => setOpen(true)}
        aria-label={`${word.word} ${t("library.detailAria")}`}
      >
        <BookOpen size={14} /> {t("library.detail")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <div>
              <DialogTitle className="flex items-center gap-3 text-4xl">
                <Languages />
                {word.word}
              </DialogTitle>
              <DialogDescription className="ml-9 text-lg">
                {word.meanings.join(" · ") || t("library.meaningNotAdded")}
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="space-y-5 p-5">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                {formatWordType(word.partOfSpeech) || t("library.typeUnspecified")}
              </Badge>
              <Badge variant="outline">{word.cefr}</Badge>
              <WordStatus score={word.score} />
            </div>
            {word.usageNote && <p className="text-sm leading-7 text-slate-600">{word.usageNote}</p>}
            <PronunciationButtons
              word={word.word}
              uk={word.pronunciationUk}
              us={word.pronunciationUs}
            />
            <div className="flex flex-wrap gap-4 border-t pt-4">
              <a
                className="flex items-center gap-1.5 text-sm font-semibold text-atlas-blue"
                href={cambridge}
                target="_blank"
                rel="noreferrer"
              >
                {t("library.openCambridge")} <ArrowUpRight size={16} />
              </a>
              {word.sourceUrl && word.sourceUrl !== cambridge && (
                <a
                  className="flex items-center gap-1.5 text-sm font-semibold text-atlas-blue"
                  href={word.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("library.openSource")} <ArrowUpRight size={16} />
                </a>
              )}
            </div>
            <h3 className="border-t pt-5 text-sm font-semibold text-atlas-navy">
              {t("library.examples")}
            </h3>
            {word.examples.length ? (
              word.examples.map((example) => (
                <WordExample
                  key={`${example.sentence}|${example.translation ?? ""}`}
                  word={word}
                  example={example}
                />
              ))
            ) : (
              <p className="text-sm text-slate-500">{t("library.noExamples")}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
