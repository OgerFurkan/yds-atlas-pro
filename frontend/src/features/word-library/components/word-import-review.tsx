import type { WordInput } from "@yds-atlas/shared";
import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import { checkSpelling } from "../api/spellcheck";
import { parseBulkWordEntries } from "../model/manual-word-import";
import type { WordFillProgress } from "../model/prepare-word-inputs";
import type { SpellcheckResult } from "../model/spellcheck.types";
import { parseWordList, wordKey } from "../model/word-normalization";
import { AiFillProgress } from "./ai-fill-progress";

interface ReviewRow extends SpellcheckResult {
  original: string;
  meanings: string[];
  accepted: boolean;
}

export function WordImportReview({
  onAccept,
  onAcceptEntries,
  onAcceptEntriesManual,
  onInputChange,
  showActions = true,
  busy = false,
  label = "Kelimeleri ekle",
  demo = false,
  onReviewed,
  onCorrected,
}: {
  onAccept?: (words: string[], onProgress?: (progress: WordFillProgress) => void) => Promise<void>;
  onAcceptEntries?: (
    entries: WordInput[],
    onProgress?: (progress: WordFillProgress) => void,
  ) => Promise<void>;
  onAcceptEntriesManual?: (entries: WordInput[]) => Promise<void>;
  onInputChange?: () => void;
  showActions?: boolean;
  busy?: boolean;
  label?: string;
  demo?: boolean;
  onReviewed?: () => void;
  onCorrected?: () => void;
}) {
  const [reduceMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [text, setText] = useState(demo && reduceMotion ? "benifit\nimprove" : "");
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<WordFillProgress | null>(null);
  const [typing, setTyping] = useState(demo && !reduceMotion);
  useEffect(() => {
    if (!demo || reduceMotion) return;
    const sample = "benifit\nimprove";
    let index = 0;
    const timer = window.setInterval(() => {
      index++;
      setText(sample.slice(0, index));
      if (index >= sample.length) {
        clearInterval(timer);
        setTyping(false);
      }
    }, 65);
    return () => clearInterval(timer);
  }, [demo, reduceMotion]);
  const valid = rows.length > 0 && rows.every((row) => row.isCorrect || row.accepted);
  const offerAi = Boolean(onAcceptEntriesManual);
  async function accept(manual = false) {
    setError("");
    setProgress(null);
    try {
      const entries = [
        ...new Map(
          rows.map(
            (row) =>
              [wordKey(row.normalized), { word: row.normalized, meanings: row.meanings }] as const,
          ),
        ).values(),
      ];
      if (manual && onAcceptEntriesManual) await onAcceptEntriesManual(entries);
      else if (onAcceptEntries) await onAcceptEntries(entries, setProgress);
      else if (onAccept)
        await onAccept(
          entries.map((entry) => entry.word),
          setProgress,
        );
    } catch (error) {
      setError(error instanceof Error ? error.message : "Kelimeler eklenemedi.");
    } finally {
      setProgress(null);
    }
  }

  async function review() {
    setChecking(true);
    setError("");
    try {
      const entries: WordInput[] = onAcceptEntries
        ? parseBulkWordEntries(text)
        : parseWordList(text).map((word) => ({ word }));
      if (entries.length > 200) throw new Error("Bir seferde en fazla 200 kelime ekleyebilirsin.");
      if (entries.some((entry) => entry.word.length > 120))
        throw new Error("Bir kelime en fazla 120 karakter olabilir.");
      setRows(
        await Promise.all(
          entries.map(async (entry) => ({
            ...(await checkSpelling(entry.word)),
            original: entry.word,
            meanings: entry.meanings ?? [],
            accepted: false,
          })),
        ),
      );
      onReviewed?.();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Yazım denetlenemedi.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-4">
      <label className="grid gap-2 text-xs font-medium text-slate-600">
        İngilizce kelimeler
        <Textarea
          id="import-text"
          aria-label="İngilizce kelime listesi"
          className="min-h-36 bg-white"
          placeholder={
            onAcceptEntries
              ? "hello = merhaba\nbenefit\nrun = koşmak"
              : "abandon\nbenefit\nconsequence"
          }
          value={text}
          disabled={checking || busy || typing}
          onChange={(event) => {
            setText(event.target.value);
            setRows([]);
            setError("");
            setProgress(null);
            onInputChange?.();
          }}
        />
        <span className="text-xs font-normal text-slate-500">
          {onAcceptEntries
            ? "Her satıra bir kelime. Anlamları = ile ayır; virgülle birden çok anlam ekle."
            : "Satır, virgül veya noktalı virgülle ayır. Başlıklar düzenlenir, tekrarlar ayıklanır."}
        </span>
      </label>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {rows.length > 0 && (
        <div
          className="max-h-64 space-y-2 overflow-y-auto rounded-lg border p-3"
          aria-live="polite"
        >
          {rows.map((row, index) => (
            <div key={row.original} className="rounded-md bg-slate-50 p-3 text-xs">
              <div className="flex items-center gap-2">
                {row.isCorrect || row.accepted ? (
                  <Check size={15} className="text-emerald-700" />
                ) : (
                  <TriangleAlert size={15} className="text-amber-700" />
                )}
                <strong>{row.normalized}</strong>
                {row.meanings.length > 0 && (
                  <span className="text-slate-600">= {row.meanings.join(", ")}</span>
                )}
                {row.original !== row.normalized && (
                  <span className="text-slate-500">← {row.original}</span>
                )}
              </div>
              {!row.isCorrect && !row.accepted && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="w-full text-amber-800">
                    Sözlükte bulunamadı. Bir öneri seç veya yazımı onayla.
                  </span>
                  {row.suggestions.map((suggestion) => (
                    <Button
                      id={suggestion === "Benefit" ? "import-suggestion" : undefined}
                      key={suggestion}
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setRows((current) =>
                          current.map((item, i) =>
                            i === index
                              ? { ...item, normalized: suggestion, isCorrect: true }
                              : item,
                          ),
                        );
                        onCorrected?.();
                        onInputChange?.();
                      }}
                    >
                      {suggestion}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="link"
                    disabled={busy}
                    onClick={() => {
                      setRows((current) =>
                        current.map((item, i) =>
                          i === index ? { ...item, accepted: true } : item,
                        ),
                      );
                      onInputChange?.();
                    }}
                  >
                    Bu yazımı kullan
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {progress && <AiFillProgress progress={progress} />}
      {showActions && (
        <div className="flex flex-wrap justify-end gap-2">
          {rows.length === 0 ? (
            <Button
              id="import-check"
              disabled={!text.trim() || checking || busy || typing}
              onClick={() => void review()}
            >
              {checking && <LoaderCircle size={15} className="animate-spin" />}Yazımı kontrol et
            </Button>
          ) : (
            <>
              {offerAi && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!valid || busy}
                  onClick={() => void accept(true)}
                >
                  Manuel kaydet
                </Button>
              )}
              <Button id="import-accept" disabled={!valid || busy} onClick={() => void accept()}>
                {busy && <LoaderCircle size={15} className="animate-spin" />}
                {offerAi ? "AI ile tamamla ve ekle" : label} ({rows.length})
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
