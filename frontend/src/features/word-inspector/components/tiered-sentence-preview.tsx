import { z } from "zod";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/shared/ui/button";
import { apiRequest } from "@/shared/api/api-client";
import { SentenceWordTooltips } from "@/features/word-library/components/sentence-word-tooltips";

const draftExample = z.object({
  difficulty: z.enum(["easy", "medium", "yds"]),
  sentence: z.string().min(12).max(1000),
  translation: z.string().min(10).max(1000),
  translationFocus: z.array(z.string().min(1).max(120)).min(1).max(4),
}).strict();
export const sentenceDraftResponseSchema = z.object({
  status: z.literal("draft"),
  word: z.string().min(2).max(45),
  examples: z.array(draftExample).length(5),
}).strict().superRefine((result, ctx) => {
  const expected = ["easy", "easy", "medium", "yds", "yds"];
  const seen = new Set<string>();
  result.examples.forEach((entry, index) => {
    if (entry.difficulty !== expected[index])
      ctx.addIssue({ code: "custom", message: "2/1/2 sırası geçersiz." });
    if (entry.translationFocus.some((part) => !entry.translation.includes(part)))
      ctx.addIssue({ code: "custom", message: "Çeviri vurgusu eksik." });
    if (seen.has(entry.sentence.toLocaleLowerCase("en")))
      ctx.addIssue({ code: "custom", message: "Tekrarlanan cümle." });
    seen.add(entry.sentence.toLocaleLowerCase("en"));
  });
});
const labels = { easy: "Kolay", medium: "Orta", yds: "YDS" } as const;

/** Explicitly requested, locally displayed AI draft. Never writes the user's library. */
export function TieredSentencePreview({ word }: { word: string }) {
  const [result, setResult] = useState<z.infer<typeof sentenceDraftResponseSchema> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current?.abort();
    setResult(null); setError(""); setLoading(false);
    return () => active.current?.abort();
  }, [word]);

  async function generate() {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setError(""); setLoading(true); setResult(null);
    try {
      const response = await apiRequest<unknown>("/api/lexicon/examples/draft", {
        method: "POST", body: JSON.stringify({ word }), signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        const parsed = sentenceDraftResponseSchema.parse(response);
        if (parsed.word.toLocaleLowerCase("en") !== word.trim().toLocaleLowerCase("en"))
          throw new Error("Üretilen örnekler seçilen kelimeye ait değil.");
        setResult(parsed);
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error
        ? reason.message : "Beş cümle hazırlanamadı.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  return <section className="mt-6 space-y-3 border-t border-slate-200 pt-5" aria-label="Seviyeli cümle taslakları">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm font-semibold text-atlas-navy">2 kolay · 1 orta · 2 YDS örneği</p>
      <Button type="button" variant="secondary" disabled={loading} onClick={() => void generate()}>
        {loading ? "Beş cümle hazırlanıyor…" : "5 cümle oluştur"}
      </Button>
    </div>
    <p className="text-xs leading-5 text-slate-500">Yalnız isteğinle AI taslağı oluşturulur. Kota kullanabilir; içerik doğrulanmış ortak havuz kaydı sayılmaz. Kişisel kelime havuzuna otomatik kaydedilmez.</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {result && <ol className="grid gap-3" aria-label="Oluşturulan beş örnek">
      {result.examples.map((item, index) => <li key={`${item.difficulty}-${index}`}
        className="rounded-xl border border-slate-200 bg-white p-4">
        <span className="text-xs font-bold text-atlas-blue">{index + 1}. {labels[item.difficulty]}</span>
        <p className="mt-2 text-base leading-7 text-atlas-navy"><SentenceWordTooltips text={item.sentence} /></p>
        <p className="mt-2 text-sm leading-6 text-slate-600">{item.translation}</p>
      </li>)}
    </ol>}
  </section>;
}
