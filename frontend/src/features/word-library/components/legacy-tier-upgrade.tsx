import type { WordEntry, WordInput } from "@yds-atlas/shared";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  aiSuggestionToWordInput,
  completeWordsWithGemini,
} from "@/features/word-library/api/ai-word-api";
import { curatedLegacyExamples } from "@/features/word-library/data/legacy-curated-examples";
import { type AiRetryNotice, withAiRecovery } from "@/features/word-library/model/ai-retry";
import { mergeLegacyTieredExamples } from "@/features/word-library/model/merge-legacy-tiered-examples";
import { hasAtlasTiers } from "@/features/word-library/model/tiered-examples";
import { wordKey } from "@/features/word-library/model/word-normalization";
import { ApiError } from "@/shared/api/api-client";
import type { Notify } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";

/** Account-scoped, resumable recovery while library is open; never edits scores or removes examples. */
export function LegacyTierUpgrade({
  words,
  onSave,
  onNotify,
  automatic = false,
}: {
  words: WordEntry[];
  onSave: (input: WordInput, id: string, expectedUpdatedAt: string) => Promise<unknown>;
  onNotify: Notify;
  automatic?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState<AiRetryNotice | null>(null);
  const cancel = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const autoStarted = useRef(false);
  const latest = useRef(words);
  useEffect(() => {
    latest.current = words;
  }, [words]);
  useEffect(
    () => () => {
      cancel.current = true;
      activeRequest.current?.abort();
    },
    [],
  );
  function stopUpgrade() {
    cancel.current = true;
    activeRequest.current?.abort();
  }
  const candidates = words.filter((word) => !hasAtlasTiers(word.examples) && !word.lexicon);
  const special = words.filter(
    (word) => !hasAtlasTiers(word.examples) && Boolean(word.lexicon),
  ).length;

  async function upgrade(unattended = false) {
    if (busy || !candidates.length) return;
    if (
      !unattended &&
      !window.confirm(
        candidates.length +
          " eski kelime için 2 kolay + 1 orta + 2 YDS örneği oluşturulacak. " +
          "Eski cümleler, anlamlar, puanlar ve ilerleme korunacak. " +
          "AI kullanım kotası harcanabilir. Devam edilsin mi?",
      )
    )
      return;
    cancel.current = false;
    setBusy(true);
    setDone(0);
    setTotal(candidates.length);
    setNotice("");
    setRetry(null);
    let completed = 0,
      skipped = 0,
      reason = "";
    try {
      // Small requests and per-word authenticated saves: partial progress is kept.
      for (let offset = 0; offset < candidates.length && !cancel.current; offset += 5) {
        const batch = candidates.slice(offset, offset + 5);
        const aiBatch = batch.filter((word) => !curatedLegacyExamples(word.word));
        let response: Awaited<ReturnType<typeof completeWordsWithGemini>> | null = null;
        if (aiBatch.length) {
          const controller = new AbortController();
          activeRequest.current = controller;
          try {
            // Reuse the bounded quota-aware retry policy used by new-word import.
            response = await withAiRecovery(
              () =>
                completeWordsWithGemini(
                  aiBatch.map((word) => word.word),
                  controller.signal,
                ),
              (state) => setRetry(state.secondsRemaining > 0 ? state : null),
              undefined,
              controller.signal,
            );
          } catch (error) {
            if (cancel.current || controller.signal.aborted) break;
            reason = error instanceof Error ? error.message : "AI geçici olarak kullanılamıyor.";
          } finally {
            if (activeRequest.current === controller) activeRequest.current = null;
            setRetry(null);
          }
        }
        const proposals = new Map(
          response?.suggestions.map((suggestion) => [wordKey(suggestion.word), suggestion]) ?? [],
        );
        for (const word of batch) {
          if (cancel.current) break;
          const fresh = latest.current.find((entry) => entry.id === word.id);
          // A concurrent edit in another tab / a deleted record must not be overwritten.
          if (
            !fresh ||
            fresh.updatedAt !== word.updatedAt ||
            fresh.lexicon ||
            hasAtlasTiers(fresh.examples)
          ) {
            skipped++;
            setDone(completed + skipped);
            continue;
          }
          const curated = curatedLegacyExamples(word.word);
          const suggestion = proposals.get(wordKey(word.word));
          if (!curated && (!response || !suggestion)) {
            skipped++;
            setDone(completed + skipped);
            continue;
          }
          try {
            const generated = curated ?? aiSuggestionToWordInput(suggestion!, response!.model);
            const input = mergeLegacyTieredExamples(fresh, generated);
            await onSave(input, fresh.id, fresh.updatedAt);
            completed++;
          } catch (error) {
            // Fail closed on a concurrent edit instead of overwriting newer notes or scores.
            skipped++;
            if (error instanceof ApiError && error.status === 409) {
              reason =
                "Bir kelime başka sekmede değişti; kütüphane yenilendi. İşlemi tekrar başlatabilirsin.";
              setDone(completed + skipped);
              break;
            }
          }
          setDone(completed + skipped);
        }
        if (reason) break;
      }
    } finally {
      activeRequest.current = null;
      setRetry(null);
      setBusy(false);
      const remaining = Math.max(0, candidates.length - completed - skipped);
      const summary =
        completed +
        " kelimeye 2/1/2 eklendi; " +
        skipped +
        " kelime değiştirilmedi." +
        (remaining > 0 ? " " + remaining + " kelime henüz işlenmedi; tekrar deneyebilirsin." : "") +
        (reason ? " İşlem durdu: " + reason : cancel.current ? " Kullanıcı durdurdu." : "");
      setNotice(summary);
      if (completed) onNotify.success(summary);
      else if (reason) onNotify.error(summary);
    }
  }
  // A single bounded pass runs after authenticated library loading. The server
  // remains the source of truth; a canceled/failed pass resumes on the next visit.
  // No private historical sentences are sent to Gemini: only English headwords.
  const runAutomaticUpgrade = useEffectEvent(() => {
    if (busy || !candidates.length || autoStarted.current) return;
    autoStarted.current = true;
    void upgrade(true);
  });
  const hasCandidates = candidates.length > 0;
  useEffect(() => {
    if (!automatic || busy || !hasCandidates || autoStarted.current) return;
    const timer = window.setTimeout(() => runAutomaticUpgrade(), 1500);
    return () => window.clearTimeout(timer);
  }, [automatic, busy, hasCandidates]);

  if (!candidates.length && !busy && !special) return null;
  return (
    <section
      className="mt-3 rounded-xl border border-sky-200 bg-sky-50/70 p-3 text-sm text-slate-800"
      aria-label="Eski kelimeleri 2/1/2 sistemine tamamlama"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <strong>{candidates.length} eski kelime için 2/1/2 cümleleri eksik</strong>
          <p className="mt-1 text-xs text-slate-600">
            5 yeni seviyeli örnek eklenir; mevcut cümlelerin, puanların ve anlamların hiçbiri
            silinmez.
          </p>
          {special > 0 && (
            <p className="text-xs text-amber-800">
              {special} sözlüğe bağlı kayıt ayrıca incelenmelidir.
            </p>
          )}
        </div>
        {busy ? (
          <Button variant="outline" type="button" onClick={stopUpgrade}>
            Durdur
          </Button>
        ) : (
          <Button type="button" onClick={() => void upgrade()} disabled={!candidates.length}>
            Eksik cümleleri 2/1/2 tamamla
          </Button>
        )}
      </div>
      {busy && (
        <div role="status" className="mt-2" aria-live="polite">
          {done}/{total} kelime tamamlandı…
        </div>
      )}
      {retry && (
        <p role="status" className="mt-2 text-xs text-amber-800">
          {retry.reason === "rate-limit" ? "Gemini kotası yenileniyor" : "Geçici bağlantı sorunu"} ·{" "}
          {retry.secondsRemaining} saniye sonra güvenli tekrar deneme.
        </p>
      )}
      {notice && (
        <p role="status" className="mt-2">
          {notice}
        </p>
      )}
    </section>
  );
}
