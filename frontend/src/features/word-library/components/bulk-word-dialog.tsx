import type { WordInput } from "@yds-atlas/shared";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { Notify } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import type { WordFillProgress } from "../model/prepare-word-inputs";
import { type WordAddMode } from "../model/manual-word-import";
import { wordKey } from "../model/word-normalization";
import { WordImportReview } from "./word-import-review";

interface BulkWordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddMany: (
    words: WordInput[],
    onProgress?: (progress: WordFillProgress) => void,
    mode?: WordAddMode,
  ) => Promise<{ added: number; duplicates: number }>;
  onNotify: Notify;
  targetDay?: number;
}

export function BulkWordDialog({ open, onOpenChange, onAddMany, onNotify, targetDay }: BulkWordDialogProps) {
  const [saving, setSaving] = useState(false);
  const [missingWords, setMissingWords] = useState<WordInput[]>([]);
  const [requestedTotal, setRequestedTotal] = useState(0);
  const [retryError, setRetryError] = useState("");

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) {
      setMissingWords([]);
      setRequestedTotal(0);
      setRetryError("");
    }
    onOpenChange(nextOpen);
  }

  async function submitWords(words: WordInput[], onProgress?: (progress: WordFillProgress) => void, mode: WordAddMode = "auto") {
    if (saving) return;

    setSaving(true);
    setRetryError("");

    let failedWords: string[] = [];

    try {
      const result = await onAddMany(
        words,
        (progress) => {
          failedWords = progress.failedWords ?? [];
          onProgress?.(progress);
        },
        mode,
      );

      const failedKeys = new Set(failedWords.map(wordKey));
      setMissingWords(words.filter((entry) => failedKeys.has(wordKey(entry.word))));

      // Keep the dialog open when some words are incomplete.
      if (failedWords.length > 0) {
        return;
      }

      onNotify.success(`${result.added} kelime eklendi, ${result.duplicates} tekrar atlandı.`);

      changeOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function retryMissing() {
    if (saving || missingWords.length === 0) return;

    try {
      // Only request previously failed words.
      await submitWords([...missingWords]);
    } catch (error) {
      setRetryError(
        error instanceof Error
          ? error.message
          : "Eksik kelimeler tamamlanamadı. Tekrar deneyebilirsin.",
      );
    }
  }

  const readyCount = Math.max(0, requestedTotal - missingWords.length);

  return (
    <Dialog open={open} onOpenChange={saving ? undefined : changeOpen}>
      <DialogContent>
        <DialogHeader>
          <div>
            <DialogTitle>{targetDay ? `${targetDay}. güne toplu kelime ekle` : "Toplu kelime ekle"}</DialogTitle>
            <DialogDescription>
              "hello = merhaba" yazarsan anlamıyla kaydederiz. Yalnız "hello" yazarsan
              AI tamamlamayı dener. AI olmadan da kaydedebilir, sonra düzenleyebilirsin.
              AI ile bir seferde en fazla 25 anlamsız kelime tamamlanır.
              {targetDay ? ` Tamamlanan kelimeler doğrudan ${targetDay}. güne yerleştirilir. Gün başına en fazla 40 kelime.` : ""}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="space-y-4 p-5">
          <WordImportReview
            busy={saving}
            onAcceptEntries={async (words, onProgress) => {
              // After partial completion, never resend already saved words.
              if (missingWords.length > 0) {
                await submitWords(missingWords, onProgress);
                return;
              }
              setRequestedTotal(words.length);
              await submitWords(words, onProgress);
            }}
            onAcceptEntriesManual={async (words) => {
              setRequestedTotal(words.length);
              await submitWords(missingWords.length > 0 ? missingWords : words, undefined, "manual");
            }}
          />

          {missingWords.length > 0 && (
            <div
              role="alert"
              className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100"
            >
              <div className="flex items-center gap-2">
                <TriangleAlert size={18} />
                <p className="text-sm font-semibold">
                  {readyCount}/{requestedTotal} kelime işlendi
                </p>
              </div>

              <p className="text-xs leading-relaxed">
                Yazdığın anlamlar kaydedildi. Şu
                {` ${missingWords.length} `}
                kelimenin anlamı AI ile tamamlanamadı:
              </p>

              <p className="break-words text-xs font-medium">{missingWords.map((entry) => entry.word).join(", ")}</p>

              {retryError && (
                <p className="text-xs font-medium" role="alert">
                  {retryError}
                </p>
              )}

              <p className="text-xs">İstersen yalnız kelimeleri kaydedip anlamlarını daha sonra ekleyebilirsin.</p>
              <Button type="button" variant="secondary" disabled={saving}
                onClick={() => void submitWords([...missingWords], undefined, "manual")}>
                AI olmadan kaydet
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => void retryMissing()}
                className="w-full"
              >
                <RefreshCw size={15} className={saving ? "animate-spin" : ""} />
                {saving
                  ? "Eksikler tamamlanıyor..."
                  : `Eksik ${missingWords.length} kelimeyi tekrar dene`}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
