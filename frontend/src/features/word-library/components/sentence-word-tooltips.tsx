import type { ReactNode } from "react";
import { createContext, useContext, useId, useMemo, useState } from "react";
import {
  buildVocabularyIndex, matchVocabulary, normalizeTooltipWord,
  splitChatSentenceSegments, splitSentenceWords, tooltipMeanings,
  type TooltipVocabulary,
} from "../model/sentence-tooltip";

const VocabularyContext = createContext<{ index: ReturnType<typeof buildVocabularyIndex>; enabled: boolean }>({index: new Map(), enabled: true});

export function SentenceVocabularyProvider({ words, enabled = true, children }: {
  words: readonly TooltipVocabulary[]; enabled?: boolean; children: ReactNode;
}) {
  const index = useMemo(() => buildVocabularyIndex(words), [words]);
  const value = useMemo(() => ({index, enabled}), [index, enabled]);
  return <VocabularyContext.Provider value={value}>{children}</VocabularyContext.Provider>;
}

/** No network or AI calls: tooltips must not spend quota, write data, or reveal answer keys. */
export function SentenceWordTooltips({ text, focusWord, allowDuringGame = false }: {
  text: string; focusWord?: TooltipVocabulary | null; allowDuringGame?: boolean;
}) {
  const {index: libraryIndex, enabled} = useContext(VocabularyContext);
  const fallbackIndex = useMemo(() => buildVocabularyIndex(focusWord ? [focusWord] : []), [focusWord]);
  const parts = useMemo(() => splitSentenceWords(text), [text]);
  const id = useId().replace(/:/g, "");
  const [active, setActive] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);

  if (!enabled && !allowDuringGame) return <>{text}</>;
  return <span data-testid="english-sentence-tooltips" lang="en" onKeyDown={(event) => {
    if (event.key === "Escape") { setActive(null); setPinned(false); }
  }}>
    {parts.map((part) => {
      if (part.kind !== "word") return <span key={part.offset}>{part.text}</span>;
      const local = matchVocabulary(part.text, libraryIndex);
      const fallback = matchVocabulary(part.text, fallbackIndex);
      const matches = local.length ? local : fallback;
      const main = matches[0];
      const meanings = matches.flatMap(tooltipMeanings).filter((v, i, all) => all.indexOf(v) === i).slice(0, 4);
      const isFocus = focusWord && normalizeTooltipWord(part.text) === normalizeTooltipWord(focusWord.word);
      const show = active === part.offset;
      const tooltipId = `${id}-tip-${part.offset}`;
      const description = meanings.length ? meanings.join(" · ") : "Kütüphanende henüz kayıtlı değil";
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
            else { setActive(part.offset); setPinned(true); }
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
          {!main && <span className="block text-slate-300">Kelimeyi Inspector'da arayabilirsin.</span>}
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