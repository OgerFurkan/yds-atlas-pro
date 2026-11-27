import type { WordInput } from "@yds-atlas/shared";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { ApiError } from "@/shared/api/api-client";
import type { Notify } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import type { WordAddMode } from "../model/manual-word-import";
import type { WordFillProgress } from "../model/prepare-word-inputs";
import { wordKey } from "../model/word-normalization";
import { WordImportReview } from "./word-import-review";

interface BulkWordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddMany: (
    words: WordInput[],
    onProgress?: (progress: WordFillProgress) => void,
    mode?: WordAddMode,
  ) => Promise<{ added: number; duplicates: number; incomplete: number }>;
  onNotify: Notify;
  targetDay?: number;
  canUseAi: boolean;
}

export function BulkWordDialog({
  open,
  onOpenChange,
  onAddMany,
  onNotify,
  targetDay,
  canUseAi,
}: BulkWordDialogProps) {
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const [missingWords, setMissingWords] = useState<WordInput[]>([]);
  const [failureReasons, setFailureReasons] = useState<Record<string, string>>({});
  const [savedCount, setSavedCount] = useState(0);
  const [submitError, setSubmitError] = useState("");

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) {
      setMissingWords([]);
      setSavedCount(0);
      setSubmitError("");
    }
    onOpenChange(nextOpen);
  }

  async function submitWords(
    words: WordInput[],
    onProgress?: (progress: WordFillProgress) => void,
    mode: WordAddMode = "auto",
  ) {
    if (lock.current) return;

    lock.current = true;
    setSaving(true);
    setSubmitError("");

    let reasons: Record<string, string> = {};
    let failedWords: string[] = [];
    let issue = "";

    try {
      const result = await onAddMany(
        words,
        (progress) => {
          failedWords = progress.failedWords ?? [];
          issue = progress.issue ?? "";
          reasons = progress.failureReasons ?? {};
          onProgress?.(progress);
        },
        mode,
      );

      setFailureReasons(reasons);
      const failedKeys = new Set(failedWords.map(wordKey));
      setMissingWords(words.filter((entry) => failedKeys.has(wordKey(entry.word))));
      const added = savedCount + result.added;

      if (failedWords.length > 0) {
        setSavedCount(added);
        setSubmitError(issue);
        return;
      }

      const note = result.incomplete
        ? ` Listedeki ${result.incomplete} kelimeyle çalışmak için eksik anlam veya örnekleri tamamla.`
        : "";
      onNotify.success(
        `Kütüphaneye ${added} kelime eklendi, ${result.duplicates} tekrar atlandı.${note}`,
      );
      changeOpen(false);
    } catch (error) {
      const failed = new Set(failedWords.map(wordKey));
      if (failed.size === words.length) {
        setMissingWords(words);
        setFailureReasons(reasons);
      }
      if (error instanceof ApiError) {
        setSubmitError(
          error.status === 401
            ? "Kaydetmek için oturumunu yenile."
            : error.status === 400 || error.status === 422
              ? "Listedeki bilgiler kabul edilmedi. Kelimeleri ve anlamları gözden geçir."
              : error.message,
        );
      } else {
        setSubmitError(error instanceof Error ? error.message : "Kelimeler kaydedilemedi.");
      }
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={saving ? undefined : changeOpen}>
      <DialogContent>
        <DialogHeader>
          <div>
            <DialogTitle>
              {targetDay ? `${targetDay}. güne toplu kelime ekle` : "Toplu kelime ekle"}
            </DialogTitle>
            <DialogDescription>
              Manuel kayıtta girdiğin bilgiler korunur. AI ile kayıtta örnekler ve eksik bilgiler
              belirttiğin Türkçe anlama göre tamamlanır.
            </DialogDescription>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-md border border-emerald-300/50 bg-emerald-50/10 px-2 py-1">
                <strong>hello = merhaba, selam</strong>
              </span>
              {canUseAi && (
                <span className="rounded-md border border-sky-300/50 bg-sky-50/10 px-2 py-1">
                  <strong>hello</strong> · AI ile tamamla
                </span>
              )}
            </div>
            {targetDay && (
              <p className="mt-1 text-[11px] opacity-75">
                {targetDay}. güne eklenir · Günlük sınır 40 kelime
              </p>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-4 p-5">
          {submitError && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {submitError}
            </p>
          )}
          <WordImportReview
            busy={saving}
            showActions={missingWords.length === 0}
            onInputChange={() => {
              // Editing after a failed AI attempt creates a NEW reviewed submission.
              // Never replay the old missingWords entry instead of "hello = merhaba".
              setMissingWords([]);
              setSavedCount(0);
              setSubmitError("");
            }}
            onAcceptEntries={(words, onProgress) => submitWords(words, onProgress)}
            onAcceptEntriesManual={
              canUseAi ? (words) => submitWords(words, undefined, "manual") : undefined
            }
          />

          {missingWords.length > 0 && (
            <div
              role="alert"
              className="space-y-3 rounded-xl border border-border bg-muted p-4 text-foreground"
            >
              <div className="flex items-center gap-2">
                <TriangleAlert size={18} />
                <p className="text-sm font-semibold">
                  {savedCount} kaydedildi · {missingWords.length} bekliyor
                </p>
              </div>

              <p className="text-xs leading-relaxed">AI bu kelimeleri tamamlayamadı:</p>

              <ul
                aria-label="Tamamlanamayan kelimeler"
                className="max-h-40 list-disc overflow-y-auto pl-5 text-xs"
              >
                {missingWords.map(({ word }) => (
                  <li key={wordKey(word)}>
                    <strong>{word}</strong>
                    {failureReasons[word] && <> · {failureReasons[word]}</>}
                  </li>
                ))}
              </ul>

              <p className="text-xs">
                Eksikleriyle kaydedebilir, anlam ve örnekleri çalışmadan önce tamamlayabilirsin.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={saving}
                  onClick={() => void submitWords([...missingWords], undefined, "manual")}
                >
                  Eksikleriyle kaydet
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={() => void submitWords([...missingWords])}
                >
                  <RefreshCw size={15} className={saving ? "animate-spin" : ""} />
                  {saving ? "Deneniyor..." : "AI ile tekrar dene"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
