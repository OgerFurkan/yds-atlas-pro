import { type AiWordResponse, type WordInput } from "@yds-atlas/shared";
import { LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/shared/ui/button";
import { aiSuggestionToWordInput, enrichWithGemini } from "../api/ai-word-api";
export function AiWordAssist({
  word,
  onApply,
}: {
  word: string;
  onApply: (input: WordInput) => void;
}) {
  const [draft, setDraft] = useState<AiWordResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  async function generate() {
    const pending = new AbortController();
    controller.current = pending;
    setBusy(true);
    setError("");
    try {
      const result = await enrichWithGemini(word, pending.signal);
      if (alive.current && !pending.signal.aborted) setDraft(result);
    } catch (error) {
      if (alive.current && !pending.signal.aborted)
        setError(error instanceof Error ? error.message : "Öneri hazırlanamadı.");
    } finally {
      if (alive.current && controller.current === pending) setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-atlas-navy">
            <Sparkles size={16} /> Gemini ile kelimeyi tamamla
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Anlam ve çevrilmiş beş örnek için öneri al; inceleyip forma aktar.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !word.trim()}
          onClick={() => void generate()}
        >
          {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Sparkles size={15} />}{" "}
          {busy ? "Hazırlanıyor…" : "Öneri oluştur"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs leading-5 text-red-700">
          {error}
        </p>
      )}
      {draft && (
        <div className="space-y-3 border-t border-blue-100 pt-3">
          <p className="text-xs font-semibold text-atlas-blue">
            GEMINI ÖNERİSİ · Kaydetmeden önce doğruluğunu kontrol et.
          </p>
          <p className="text-sm font-semibold">
            {draft.suggestion.word} · {draft.suggestion.meanings.join(" / ")}
          </p>
          <p className="text-xs leading-6 text-slate-600">{draft.suggestion.usageNote}</p>
          <details className="text-xs text-slate-600">
            <summary className="cursor-pointer font-semibold">
              5 örneği ve çevirisini incele
            </summary>
            <ol className="mt-3 space-y-3">
              {draft.suggestion.examples.map((example) => (
                <li key={example.sentence}>
                  <p>{example.sentence}</p>
                  <p className="mt-1 text-slate-500">{example.translation}</p>
                  {draft.dictionarySource?.examples.some(
                    (source) => source.sentence.trim() === example.sentence.trim(),
                  ) && (
                    <a
                      className="mt-1 inline-block text-[11px] underline underline-offset-2"
                      href={draft.dictionarySource.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Wiktionary · {draft.dictionarySource.licenseName}
                    </a>
                  )}
                </li>
              ))}
            </ol>
          </details>
          <Button
            size="sm"
            className="w-full"
            onClick={() => {
              onApply(
                aiSuggestionToWordInput(draft.suggestion, draft.model, draft.dictionarySource),
              );
              setDraft(null);
            }}
          >
            İnceledim, öneriyi forma aktar
          </Button>
        </div>
      )}
    </section>
  );
}
