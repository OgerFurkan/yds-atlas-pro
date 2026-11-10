import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import { checkSpelling } from "../api/spellcheck";
import type { SpellcheckResult } from "../model/spellcheck.types";
import { parseWordList } from "../model/word-normalization";

interface ReviewRow extends SpellcheckResult {
  original: string;
  accepted: boolean;
}

export function WordImportReview({
  onAccept,
  busy = false,
  label = "Kelimeleri ekle",
  demo = false,
  onReviewed,
  onCorrected,
}: {
  onAccept: (words: string[]) => Promise<void>;
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

  async function review() {
    const words = parseWordList(text);
    if (words.length > 200) {
      setError("Bir seferde en fazla 200 kelime ekleyebilirsin.");
      return;
    }
    if (words.some((word) => word.length > 120)) {
      setError("Bir kelime en fazla 120 karakter olabilir.");
      return;
    }
    setChecking(true);
    setError("");
    try {
      setRows(
        await Promise.all(
          words.map(async (original) => ({
            ...(await checkSpelling(original)),
            original,
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
          placeholder={"abandon\nbenefit\nconsequence"}
          value={text}
          disabled={checking || busy || typing}
          onChange={(event) => {
            setText(event.target.value);
            setRows([]);
            setError("");
          }}
        />
        <span className="text-xs font-normal text-slate-500">
          Satır, virgül veya noktalı virgülle ayır. Başlıklar düzenlenir, tekrarlar ayıklanır.
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
                      }}
                    >
                      {suggestion}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="link"
                    disabled={busy}
                    onClick={() =>
                      setRows((current) =>
                        current.map((item, i) =>
                          i === index ? { ...item, accepted: true } : item,
                        ),
                      )
                    }
                  >
                    Bu yazımı kullan
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
        {rows.length === 0 ? (
          <Button
            id="import-check"
            disabled={!text.trim() || checking || busy || typing}
            onClick={() => void review()}
          >
            {checking && <LoaderCircle size={15} className="animate-spin" />}Yazımı kontrol et
          </Button>
        ) : (
          <Button
            id="import-accept"
            disabled={!valid || busy}
            onClick={async () => {
              setError("");
              try {
                await onAccept([...new Set(rows.map((row) => row.normalized))]);
              } catch (error) {
                setError(error instanceof Error ? error.message : "Kelimeler eklenemedi.");
              }
            }}
          >
            {busy && <LoaderCircle size={15} className="animate-spin" />}
            {label} ({rows.length})
          </Button>
        )}
      </div>
    </div>
  );
}
