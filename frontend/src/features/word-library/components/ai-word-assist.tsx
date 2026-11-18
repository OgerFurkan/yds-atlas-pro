import { wordPartOfSpeechSchema, type AiWordResponse, type WordInput, type WordPartOfSpeech } from "@yds-atlas/shared";
import { LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/shared/ui/button";
import { SentenceWordTooltips } from "./sentence-word-tooltips";
import { enrichWithGemini, fetchLexiconCandidates } from "../api/ai-word-api";
import { combineWordSenses } from "../model/combine-word-senses";

const turkishType: Record<WordPartOfSpeech, string> = {
  Noun: "İsim", Verb: "Fiil", Adjective: "Sıfat", Adverb: "Zarf",
  Preposition: "Edat", Conjunction: "Bağlaç", Pronoun: "Zamir", Phrase: "İfade",
};

export function AiWordAssist({ word, onApply }: { word: string; onApply: (input: WordInput) => void }) {
  const [requestedTypes, setRequestedTypes] = useState<WordPartOfSpeech[]>([]);
  const [drafts, setDrafts] = useState<AiWordResponse[]>([]);
  const [included, setIncluded] = useState<WordPartOfSpeech[]>([]);
  const [primary, setPrimary] = useState<WordPartOfSpeech | "">("");
  const [candidateOptions,setCandidateOptions]=useState<Array<{partOfSpeech:WordPartOfSpeech;meaning:string;revision:number}>>([]);
  const [chosenSense,setChosenSense]=useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [partialErrors, setPartialErrors] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);

  function toggleRequested(type: WordPartOfSpeech) {
    setRequestedTypes((current) => current.includes(type)
      ? current.filter((item) => item !== type)
      : current.length < 3 ? [...current, type] : current);
    setDrafts([]);
    setIncluded([]);
    setError("");
  }

  async function generate() {
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    setBusy(true);
    setDrafts([]);
    setError("");
    setPartialErrors([]);
    const successful: AiWordResponse[] = [];
    const failures: string[] = [];
    const targets = requestedTypes.length ? requestedTypes : [undefined];
    try {
      for (const type of targets) {
        if (pending.signal.aborted) return;
        try {
          const selected=candidateOptions.find(c=>`${c.partOfSpeech}:${c.meaning}`===chosenSense);
          const result=await enrichWithGemini(word,pending.signal,type,selected && selected.partOfSpeech===type?selected.meaning:undefined);
          if (type && result.suggestion.partOfSpeech !== type) {
            failures.push(`${turkishType[type]}: AI farklı kelime türü döndürdü.`);
          } else {
            successful.push(result);
          }
        } catch (reason) {
          if (pending.signal.aborted) return;
          try {
            const matches=await fetchLexiconCandidates(word);
            if(matches.candidates.length>1)setCandidateOptions(matches.candidates);
          } catch { /* Keep original provider error. */ }
          failures.push(`${type ? turkishType[type] + ": " : ""}${reason instanceof Error ? reason.message : "Öneri alınamadı."}`);
        }
      }
      if (!alive.current || pending.signal.aborted) return;
      setDrafts(successful);
      setIncluded(successful.map((item) => item.suggestion.partOfSpeech));
      setPrimary(successful[0]?.suggestion.partOfSpeech ?? "");
      setPartialErrors(failures);
      if (!successful.length) setError("Seçilen türler için doğrulanmış öneri alınamadı. Başka bir tür seçerek tekrar dene.");
    } finally {
      if (alive.current && controller.current === pending) setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-atlas-navy">
            <Sparkles size={16} /> Ortak havuz ile kelimeyi tamamla
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            İstediğin kelime türlerini seç. Her tür için ayrı anlam ve çevrilmiş beş örnek oluşturulur.
          </p>
        </div>
        <Button variant="outline" size="sm" type="button" disabled={busy || !word.trim()} onClick={() => void generate()}>
          {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {busy ? "Hazırlanıyor…" : "Öneri oluştur"}
        </Button>
      </div>
      <fieldset className="flex flex-wrap gap-2" disabled={busy}>
        <legend className="mb-1 text-xs font-semibold text-slate-700">
          Kelime türü (en fazla 3; seçmezsen Gemini önerir)
        </legend>
        {wordPartOfSpeechSchema.options.map((type) => (
          <label key={type} className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-blue-200 bg-white px-2.5 py-2 text-xs text-slate-800">
            <input type="checkbox" className="accent-atlas-orange" checked={requestedTypes.includes(type)}
              onChange={() => toggleRequested(type)} disabled={busy || (requestedTypes.length >= 3 && !requestedTypes.includes(type))}
              aria-label={`${turkishType[type]} türünü iste`} />
            {turkishType[type]} <span className="text-slate-400">({type})</span>
          </label>
        ))}
      </fieldset>
      {candidateOptions.length>1 && (
        <label className="block space-y-1 text-xs font-semibold text-slate-800 dark:text-slate-100">
          Ortak havuzda birden fazla anlam bulundu. Kullanmak istediğin anlamı seç:
          <select className="w-full min-h-11 rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            value={chosenSense}
            onChange={event=>{
              const value=event.target.value;setChosenSense(value);
              const candidate=candidateOptions.find(item=>`${item.partOfSpeech}:${item.meaning}`===value);
              if(candidate)setRequestedTypes([candidate.partOfSpeech]);
            }} aria-label="Kelime anlamı seçimi">
            <option value="">Bir kelime türü ve anlam seç</option>
            {candidateOptions.map(item=><option key={`${item.partOfSpeech}:${item.meaning}`} value={`${item.partOfSpeech}:${item.meaning}`}>
              {turkishType[item.partOfSpeech]} · {item.meaning}
            </option>)}
          </select>
        </label>
      )}
      {requestedTypes.length > 1 && <p className="text-xs text-slate-500">Havuzda bulunmayan her kelime türü için ayrı AI isteği gerekebilir. Yalnızca doğrulanabilen öneriler kayda alınır.</p>}
      {error && <p role="alert" className="text-xs leading-5 text-red-700">{error}</p>}
      {partialErrors.length > 0 && (
        <div role="status" className="space-y-1 text-xs text-amber-800">
          {partialErrors.map((message) => <p key={message}>{message}</p>)}
        </div>
      )}
      {drafts.length > 0 && (
        <div className="space-y-3 border-t border-blue-100 pt-3">
          <p className="text-xs font-semibold text-atlas-blue">HAVUZ VE AI ÖNERİLERİ · Otomatik denetlenen içerikleri kaydetmeden önce incele.</p>
          {drafts.map((draft) => {
            const suggestion = draft.suggestion;
            return (
              <div key={suggestion.partOfSpeech} className="space-y-2 rounded-xl border border-blue-100 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-atlas-navy">
                  <input type="checkbox" className="accent-atlas-orange" checked={included.includes(suggestion.partOfSpeech)}
                    onChange={(event) => setIncluded((current) => event.target.checked
                      ? [...current, suggestion.partOfSpeech]
                      : current.filter((type) => type !== suggestion.partOfSpeech))}
                    aria-label={`${turkishType[suggestion.partOfSpeech]} önerisini kaydet`} />
                  {suggestion.word} · {turkishType[suggestion.partOfSpeech]} · {draft.provider === "Lexicon" ? "Havuz" : "AI üretimi"}
                </label>
                <p className="text-xs text-slate-700">{suggestion.meanings.join(" · ")}</p>
                <p className="text-xs leading-5 text-slate-500 dark:text-slate-300">{suggestion.usageNote}</p>
                {draft.lexicon && (
                  <p className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" role="status">
                    {draft.lexicon.source==="pool"?"Ortak havuzdan getirildi":"AI ile üretildi ve ortak havuza kaydedildi"}
                  </p>
                )}
                <details className="text-xs text-slate-600">
                  <summary className="cursor-pointer font-semibold">5 örneği ve çevirisini incele</summary>
                  <ol className="mt-3 grid gap-2" aria-label="Kelime çalışma örnekleri">
                    {suggestion.examples.map((example) => (
                      <li key={example.sentence} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                        <span className="mb-2 inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-900 dark:bg-blue-900 dark:text-blue-100">
                          {example.difficulty==="easy"?"Kolay":example.difficulty==="medium"?"Orta":example.difficulty==="yds"?"YDS":"İnceleme gerekli"}
                        </span>
                        <p className="break-words font-medium leading-6 text-slate-900 dark:text-slate-100"><SentenceWordTooltips text={example.sentence} focusWord={suggestion} /></p>
                        <p className="mt-1 break-words leading-5 text-slate-600 dark:text-slate-300">{example.translation}</p>
                      </li>
                    ))}
                  </ol>
                </details>
              </div>
            );
          })}
          {included.length > 1 && (
            <label className="block text-xs font-semibold text-atlas-navy">
              Oyunda kullanılacak ana kelime türü
              <select className="mt-1 block min-h-10 w-full rounded-md border border-blue-200 bg-white px-3 text-sm text-slate-800"
                value={included.includes(primary as WordPartOfSpeech) ? primary : included[0]}
                onChange={(event) => setPrimary(event.target.value as WordPartOfSpeech)}>
                {included.map((type) => <option key={type} value={type}>{turkishType[type]}</option>)}
              </select>
            </label>
          )}
          <Button size="sm" className="w-full" type="button" disabled={included.length === 0}
            onClick={() => {
              try {
                const combined=combineWordSenses(drafts,included,primary||undefined);
                const selectedPrimary=drafts.find(d=>d.suggestion.partOfSpeech===(primary||included[0]));
                if(selectedPrimary?.suggestion.lexicon)combined.lexicon=selectedPrimary.suggestion.lexicon;
                onApply(combined);
                setDrafts([]);
                setIncluded([]);
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : "Öneriler aktarılamadı.");
              }
            }}>
            {included.length} türü inceleyip forma aktar
          </Button>
        </div>
      )}
    </section>
  );
}
