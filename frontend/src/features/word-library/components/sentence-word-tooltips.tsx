import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { inspectFromPool, lookupOpenTurkishDictionary, INSPECTOR_UI_ENABLED, type InspectorResult, type OpenTurkishDictionary } from "@/features/word-inspector/api/word-inspector-api";
import {
  buildVocabularyIndex, matchVocabulary, normalizeTooltipWord,
  splitChatSentenceSegments, splitSentenceWords, tooltipMeanings,
  type TooltipVocabulary,
} from "../model/sentence-tooltip";

type TooltipContext = {
  index: ReturnType<typeof buildVocabularyIndex>; enabled: boolean;
  userId: string | null; allowPoolLookup: boolean;
};
const VocabularyContext = createContext<TooltipContext>({index: new Map(), enabled: true, userId: null, allowPoolLookup: false});
type Attribution={provider:string;url:string;license:"CC BY-SA 4.0";licenseUrl:string};
export type CachedTooltip={status:"ready";word:TooltipVocabulary;source:"pool"|"open";attribution?:Attribution}
|{status:"choices";meanings:string[];attribution?:Attribution}|{status:"missing"}|{status:"error"};
/** Inspector is already validated by Zod. Never accept unreviewed generated text as a translation. */
export function tooltipFromInspector(result: InspectorResult): CachedTooltip {
  if (result.status === "missing") return {status: "missing"};
  if (result.status === "choices") return {status: "choices", meanings: result.choices.slice(0, 8).map(choice => choice.partOfSpeech + ": " + choice.meaning)};
  return {status: "ready", source: "pool", word: {word: result.entry.word,
    partOfSpeech: result.entry.partOfSpeech, meanings: result.entry.meanings,
    alternatives: result.entry.alternatives, pronunciationUk: result.entry.pronunciationUk,
    pronunciationUs: result.entry.pronunciationUs, cefr: result.entry.cefr}};
}

/** Externally licensed meanings never mutate personal/canonical vocabulary. */
export function tooltipFromOpenDictionary(result:OpenTurkishDictionary):CachedTooltip {
 if(result.status==="missing"||result.entries.length===0)return {status:"missing"};
 if(result.status==="choices"||result.entries.length>1)return {status:"choices",attribution:result.source,meanings:result.entries.map(e=>e.partOfSpeech+": "+e.meanings.slice(0,4).join(" · "))};
 const e=result.entries[0];return {status:"ready",source:"open",attribution:result.source,word:{word:result.word,partOfSpeech:e.partOfSpeech,meanings:e.meanings}};
}
export function SentenceVocabularyProvider({ words, enabled = true, userId = null, allowPoolLookup = false, children }: {
  words: readonly TooltipVocabulary[]; enabled?: boolean; userId?: string | null; allowPoolLookup?: boolean; children: ReactNode;
}) {
  const index = useMemo(() => buildVocabularyIndex(words), [words]);
  const value = useMemo(() => ({index, enabled, userId, allowPoolLookup: allowPoolLookup && INSPECTOR_UI_ENABLED && enabled && !!userId}),
    [index, enabled, userId, allowPoolLookup]);
  return <VocabularyContext.Provider value={value}>{children}</VocabularyContext.Provider>;
}

/** No hover network calls, AI calls, writes or answer-key disclosures. Explicit-click cache-only GET only. */
export function SentenceWordTooltips({ text, focusWord, allowDuringGame = false }: {
  text: string; focusWord?: TooltipVocabulary | null; allowDuringGame?: boolean;
}) {
  const {index: libraryIndex, enabled, userId, allowPoolLookup} = useContext(VocabularyContext);
  const [poolLookup, setPoolLookup] = useState<Record<string, CachedTooltip>>({});
  const [loadingWord, setLoadingWord] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    setPoolLookup({}); setLoadingWord(null); activeRequest.current?.abort(); activeRequest.current = null;
    return () => activeRequest.current?.abort();
  }, [userId]);
  function loadFromPool(key: string) {
    if (!userId || !allowPoolLookup || loadingWord || poolLookup[key]) return;
    activeRequest.current?.abort();
    const controller = new AbortController(); activeRequest.current = controller; setLoadingWord(key);
    void inspectFromPool({word: key}, userId, controller.signal)
      .then(async result => result.status==="missing"
        ? tooltipFromOpenDictionary(await lookupOpenTurkishDictionary(key,userId,controller.signal))
        : tooltipFromInspector(result))
      .then(result=>{if(!controller.signal.aborted)setPoolLookup(prev=>({...prev,[key]:result}));})
      .catch(() => {if (!controller.signal.aborted) setPoolLookup(prev => ({...prev, [key]: {status:"error"}}));})
      .finally(() => {if (!controller.signal.aborted) setLoadingWord(null);});
  }
  const fallbackIndex = useMemo(() => buildVocabularyIndex(focusWord ? [focusWord] : []), [focusWord]);
  const parts = useMemo(() => splitSentenceWords(text), [text]);
  const id = useId().replace(/:/g, "");
  const [active, setActive] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);

  if (!enabled && !allowDuringGame) return <>{text}</>;
  return <span data-testid="english-sentence-tooltips" lang="en" onKeyDown={(event) => {
    if (event.key === "Escape" && active !== null) {
      event.preventDefault();
      event.stopPropagation(); // A focused tooltip closes before its parent modal/dialog.
      if (event.target instanceof HTMLElement) event.target.blur();
      setActive(null); setPinned(false);
    }
  }}>
    {parts.map((part) => {
      if (part.kind !== "word") return <span key={part.offset}>{part.text}</span>;
      const local = matchVocabulary(part.text, libraryIndex);
      const fallback = matchVocabulary(part.text, fallbackIndex);
      // An explicit Inspector/sense selection takes priority over a different personal-library sense.
      // Only the focused lemma uses this override; surrounding words still use the library.
      const isFocus = Boolean(focusWord && fallback.length > 0);
      const matches = isFocus ? fallback : local;
      const key = normalizeTooltipWord(part.text);
      const cached = !matches.length ? poolLookup[key] : undefined;
      const pooledWord = cached?.status === "ready" ? cached.word : undefined;
      const main = matches[0] ?? pooledWord;
      const meanings = (pooledWord ? tooltipMeanings(pooledWord) : matches.flatMap(tooltipMeanings)).filter((v, i, all) => all.indexOf(v) === i).slice(0, 4);
      const show = active === part.offset;
      const tooltipId = `${id}-tip-${part.offset}`;
      const description = meanings.length ? meanings.join(" · ") :
        cached?.status === "choices" ? cached.meanings.join(" · ") :
        cached?.status === "missing" ? "Güvenilir kaynaklarda Türkçe karşılık bulunamadı" :
        cached?.status === "error" ? "Sözlük şu anda kullanılamıyor" :
        loadingWord === key ? "Ortak havuzda aranıyor…" : "Kütüphanende henüz kayıtlı değil";
      return <span key={part.offset} className="relative inline" onMouseLeave={() => {
        if (!pinned) setActive(null);
      }}>
        <button type="button" data-testid="sentence-word" data-word={normalizeTooltipWord(part.text)}
          aria-label={`${part.text}: ${description}`}
          aria-describedby={show ? tooltipId : undefined}
          aria-expanded={show && pinned}
          onMouseEnter={() => { if (!pinned) setActive(part.offset); }}
          onFocus={() => setActive(part.offset)}
          onBlur={() => { if (!pinned) setActive(null); }}
          onClick={() => {
            if (show && pinned) { setActive(null); setPinned(false); }
            else { setActive(part.offset); setPinned(true);
              if (!matches.length && !cached && allowPoolLookup) loadFromPool(key);
            }
          }}
          className="cursor-help rounded-sm border-b border-dotted border-current/50 bg-transparent p-0 text-inherit underline-offset-2 hover:border-atlas-blue hover:text-atlas-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-atlas-blue"
        >
          {isFocus ? <strong className="font-bold italic">{part.text}</strong> : part.text}
        </button>
        {show && <span id={tooltipId} role="tooltip"
          data-testid="sentence-word-definition"
          className="absolute bottom-[calc(100%+0.45rem)] left-1/2 z-60 block w-max max-w-[min(17rem,85vw)] -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-left text-xs font-normal leading-5 text-white shadow-xl"
        >
          <span className="block font-semibold capitalize">{main?.word ?? part.text}</span>
          {main && <span className="block text-slate-300">{main.partOfSpeech}{main.cefr && main.cefr !== "Belirtilmedi" ? ` · ${main.cefr}` : ""}</span>}
          <span className="mt-1 block">{description}</span>
          {main?.pronunciationUk && <span className="block text-slate-300">UK {main.pronunciationUk}</span>}
          {main?.pronunciationUs && <span className="block text-slate-300">US {main.pronunciationUs}</span>}
          {cached?.status === "ready" && cached.source === "pool" && <span className="block text-slate-300">Kaynak: doğrulanmış ortak sözlük</span>}
          {cached && "attribution" in cached && cached.attribution && <span className="block text-amber-200">Dış sözlükteki olası anlam; cümlenin bağlamı doğrulanmadı.</span>}
          {cached && "attribution" in cached && cached.attribution && <span className="mt-2 block text-slate-300">
            <a href={cached.attribution.url} rel="noopener noreferrer" target="_blank" className="underline">Wiktionary</a> · <a href={cached.attribution.licenseUrl} rel="noopener noreferrer" target="_blank" className="underline">CC BY-SA 4.0</a> · <a href="https://freedictionaryapi.com" rel="noopener noreferrer" target="_blank" className="underline">FreeDictionaryAPI.com</a>
          </span>}
          {cached?.status === "choices" && <span className="block text-slate-300">Birden fazla anlam bulundu. Inspector'da uygun anlamı seç.</span>}
          {!main && allowPoolLookup && !cached && <span className="block text-slate-300">Ortak sözlükte aramak için kelimeye tıkla.</span>}
          {!main && (!allowPoolLookup || cached?.status === "missing") && <span className="block text-slate-300">Kelimeyi Inspector'da arayabilirsin.</span>}
        </span>}
      </span>;
    })}
  </span>;
}

/** Only English prose. Do not tokenize Turkish replies, URLs, code or raw markdown links. */
export function EnglishChatSentenceTooltips({ text }: { text: string }) {
  const segments = useMemo(() => splitChatSentenceSegments(text), [text]);
  return <>{segments.map((segment, index) => segment.english
    ? <SentenceWordTooltips key={index} text={segment.text}/>
    : <span key={index}>{segment.text}</span>)}</>;
}