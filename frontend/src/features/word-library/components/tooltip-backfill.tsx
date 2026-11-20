import { useState } from "react";
import { apiRequest } from "@/shared/api/api-client";
import type { Notify } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";

type BackfillResult = {
  status: "queued";
  scannedWords: number;
  scannedSentences: number;
  distinctCandidates: number;
  queuedCandidates: number;
  deduplicatedGlobally: boolean;
  mayBeIncomplete: boolean;
};

/** User consent is required before extracting personal sentence vocabulary. */
export function TooltipBackfill({ onNotify }: { onNotify: Notify }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BackfillResult | null>(null);
  const [failure, setFailure] = useState("");
  async function start() {
    if (running) return;
    if (!window.confirm(
      "Kendi Kütüphanendeki eski İngilizce cümleler taransın mı? " +
      "Yalnız İngilizce sözcükler ortak Türkçe sözlük kuyruğuna gönderilir. " +
      "Cümlelerin, hesap bilgilerin, puanların ve kayıtların değiştirilmez. " +
      "Türkçe karşılıkları doğrulanabilen sözcükler kademeli kaydedilir.",
    )) return;
    setRunning(true); setFailure(""); setResult(null);
    try {
      const queued = await apiRequest<BackfillResult>("/api/lexicon/tooltip/backfill", {
        method: "POST",
      });
      setResult(queued);
      onNotify.success("Eski cümlelerdeki sözcükler doğrulama kuyruğuna alındı.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tarama başlatılamadı.";
      setFailure(message);
      onNotify.error(message);
    } finally { setRunning(false); }
  }
  return <section className="mt-3 rounded-xl border border-sky-200 bg-sky-50/70 p-3 text-sm text-slate-800"
    aria-label="Eski cümleleri Türkçe tooltip sözlüğüne ekle">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <strong>Eski cümlelerin Türkçe kelime anlamlarını hazırla</strong>
        <p className="mt-1 text-xs text-slate-600">
          İngilizce sözcükler tekrarları ayıklanarak ortak sözlüğe alınır.
          Türkçe karşılığı güvenilir kaynaktan bulunanlar kademeli görünür.
          Eski cümlelerin, puanların ve kelime listen değişmez.
        </p>
      </div>
      <Button type="button" onClick={() => void start()} disabled={running}>
        {running ? "Cümleler taranıyor…" : "Eski cümleleri sözlüğe ekle"}
      </Button>
    </div>
    {result && <p role="status" className="mt-2 text-sm text-emerald-900">
      {result.scannedWords} kelimedeki {result.scannedSentences} cümle tarandı.
      {" "}{result.queuedCandidates} farklı İngilizce sözcük sıraya alındı.
      Bunlar henüz hazır Türkçe çeviri sayılmaz; sonuçlar kaynak doğrulandıkça gelecek.
      {result.mayBeIncomplete && " Tarama güvenlik sınırına ulaştı; kalan içerik ayrı işlenmeli."}
    </p>}
    {failure && <p role="alert" className="mt-2 text-sm text-red-800">{failure}</p>}
  </section>;
}
