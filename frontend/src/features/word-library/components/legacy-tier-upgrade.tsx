import type { WordEntry, WordInput } from "@yds-atlas/shared";
import { useEffect, useRef, useState } from "react";
import { aiSuggestionToWordInput, completeWordsWithGemini } from "@/features/word-library/api/ai-word-api";
import { mergeLegacyTieredExamples } from "@/features/word-library/model/merge-legacy-tiered-examples";
import { hasAtlasTiers } from "@/features/word-library/model/tiered-examples";
import { wordKey } from "@/features/word-library/model/word-normalization";
import type { Notify } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";

/** Explicit opt-in, account-scoped recovery of legacy entries; never edits scores or removes examples. */
export function LegacyTierUpgrade({ words, onSave, onNotify }: {
  words: WordEntry[];
  onSave: (input: WordInput, id?: string) => Promise<void>;
  onNotify: Notify;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [notice, setNotice] = useState("");
  const cancel = useRef(false);
  const latest = useRef(words);
  useEffect(() => { latest.current = words; }, [words]);
  const candidates = words.filter(word => !hasAtlasTiers(word.examples) && !word.lexicon);
  const special = words.filter(word => !hasAtlasTiers(word.examples) && Boolean(word.lexicon)).length;

  async function upgrade() {
    if (busy || !candidates.length) return;
    if (!window.confirm(
      candidates.length + " eski kelime için 2 kolay + 1 orta + 2 YDS örneği oluşturulacak. " +
      "Eski cümleler, anlamlar, puanlar ve ilerleme korunacak. " +
      "AI kullanım kotası harcanabilir. Devam edilsin mi?",
    )) return;
    cancel.current = false;
    setBusy(true); setDone(0); setTotal(candidates.length); setNotice("");
    let completed = 0, skipped = 0, reason = "";
    try {
      // Small requests and per-word authenticated saves: partial progress is kept.
      for (let offset = 0; offset < candidates.length && !cancel.current; offset += 5) {
        const batch = candidates.slice(offset, offset + 5);
        let response: Awaited<ReturnType<typeof completeWordsWithGemini>>;
        try {
          response = await completeWordsWithGemini(batch.map(word => word.word));
        } catch (error) {
          reason = error instanceof Error ? error.message : "AI geçici olarak kullanılamıyor.";
          break;
        }
        const proposals = new Map(response.suggestions.map(suggestion => [wordKey(suggestion.word), suggestion]));
        for (const word of batch) {
          if (cancel.current) break;
          const fresh = latest.current.find(entry => entry.id === word.id);
          // A concurrent edit in another tab / a deleted record must not be overwritten.
          if (!fresh || fresh.updatedAt !== word.updatedAt || fresh.lexicon || hasAtlasTiers(fresh.examples)) {
            skipped++; setDone(completed + skipped); continue;
          }
          const suggestion = proposals.get(wordKey(word.word));
          if (!suggestion) { skipped++; setDone(completed + skipped); continue; }
          try {
            const generated = aiSuggestionToWordInput(suggestion, response.model);
            const input = mergeLegacyTieredExamples(fresh, generated);
            await onSave(input, fresh.id);
            completed++;
          } catch {
            // Preserve the original row and let the user retry this item later.
            skipped++;
          }
          setDone(completed + skipped);
        }
      }
    } finally {
      setBusy(false);
      const summary = completed + " kelimeye 2/1/2 eklendi; " + skipped + " kelime değiştirilmedi." +
        (reason ? " İşlem durdu: " + reason : cancel.current ? " Kullanıcı durdurdu." : "");
      setNotice(summary);
      if (completed) onNotify.success(summary);
      else if (reason) onNotify.error(summary);
    }
  }
  if (!candidates.length && !busy && !special) return null;
  return <section className="mt-3 rounded-xl border border-sky-200 bg-sky-50/70 p-3 text-sm text-slate-800" aria-label="Eski kelimeleri 2/1/2 sistemine tamamlama">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <strong>{candidates.length} eski kelime için 2/1/2 cümleleri eksik</strong>
        <p className="mt-1 text-xs text-slate-600">5 yeni seviyeli örnek eklenir; mevcut cümlelerin, puanların ve anlamların hiçbiri silinmez.</p>
        {special > 0 && <p className="text-xs text-amber-800">{special} sözlüğe bağlı kayıt ayrıca incelenmelidir.</p>}
      </div>
      {busy ? <Button variant="outline" type="button" onClick={() => { cancel.current = true; }}>Durdur</Button>
        : <Button type="button" onClick={() => void upgrade()} disabled={!candidates.length}>Eksik cümleleri 2/1/2 tamamla</Button>}
    </div>
    {busy && <div role="status" className="mt-2" aria-live="polite">{done}/{total} kelime tamamlandı…</div>}
    {notice && <p role="status" className="mt-2">{notice}</p>}
  </section>;
}
