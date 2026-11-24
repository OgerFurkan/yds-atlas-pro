import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  INSPECTOR_UI_ENABLED,
  type InspectorResult,
  inspectFromPool,
  lookupOpenTurkishDictionary,
  type OpenTurkishDictionary,
} from "@/features/word-inspector/api/word-inspector-api";
import { ApiError } from "@/shared/api/api-client";
import { withOccurrenceKeys } from "@/shared/lib/occurrence-keys";
import {
  buildVocabularyIndex,
  matchVocabulary,
  normalizeTooltipWord,
  splitChatSentenceSegments,
  splitSentenceWords,
  type TooltipVocabulary,
  tooltipMeanings,
} from "../model/sentence-tooltip";

type TooltipContext = {
  index: ReturnType<typeof buildVocabularyIndex>;
  enabled: boolean;
  userId: string | null;
  allowPoolLookup: boolean;
  allowDictionaryLookup: boolean;
};
const VocabularyContext = createContext<TooltipContext>({
  index: new Map(),
  enabled: true,
  userId: null,
  allowPoolLookup: false,
  allowDictionaryLookup: false,
});
type Attribution = { provider: string; url: string; license: "CC BY-SA 4.0"; licenseUrl: string };
type CachedTooltip =
  | { status: "ready"; word: TooltipVocabulary; source: "pool" | "open"; attribution?: Attribution }
  | { status: "choices"; meanings: string[]; attribution?: Attribution }
  | { status: "missing" }
  | { status: "error" };
/** Inspector is already validated by Zod. Never accept unreviewed generated text as a translation. */
function tooltipFromInspector(result: InspectorResult): CachedTooltip {
  if (result.status === "missing") return { status: "missing" };
  if (result.status === "choices")
    return {
      status: "choices",
      meanings: result.choices
        .slice(0, 8)
        .map((choice) => choice.partOfSpeech + ": " + choice.meaning),
    };
  return {
    status: "ready",
    source: "pool",
    word: {
      word: result.entry.word,
      partOfSpeech: result.entry.partOfSpeech,
      meanings: result.entry.meanings,
      alternatives: result.entry.alternatives,
      pronunciationUk: result.entry.pronunciationUk,
      pronunciationUs: result.entry.pronunciationUs,
      cefr: result.entry.cefr,
    },
  };
}

/** Externally licensed meanings never mutate personal/canonical vocabulary. */
function tooltipFromOpenDictionary(result: OpenTurkishDictionary): CachedTooltip {
  if (result.status === "missing" || result.entries.length === 0) return { status: "missing" };
  if (result.status === "choices" || result.entries.length > 1)
    return {
      status: "choices",
      attribution: result.source,
      meanings: result.entries.map(
        (e) => e.partOfSpeech + ": " + e.meanings.slice(0, 4).join(" · "),
      ),
    };
  const e = result.entries[0];
  return {
    status: "ready",
    source: "open",
    attribution: result.source,
    word: { word: result.word, partOfSpeech: e.partOfSpeech, meanings: e.meanings },
  };
}
export function SentenceVocabularyProvider({
  words,
  enabled = true,
  userId = null,
  allowPoolLookup = false,
  allowDictionaryLookup = false,
  children,
}: {
  words: readonly TooltipVocabulary[];
  enabled?: boolean;
  userId?: string | null;
  allowPoolLookup?: boolean;
  allowDictionaryLookup?: boolean;
  children: ReactNode;
}) {
  const index = useMemo(() => buildVocabularyIndex(words), [words]);
  // The authenticated dictionary GET is independent of the optional Inspector UI.
  // App gates it during an active game; the backend re-checks auth/assessment.
  const value = useMemo(
    () => ({
      index,
      enabled,
      userId,
      allowPoolLookup: allowPoolLookup && INSPECTOR_UI_ENABLED && enabled && !!userId,
      allowDictionaryLookup: allowDictionaryLookup && enabled && !!userId,
    }),
    [index, enabled, userId, allowPoolLookup, allowDictionaryLookup],
  );
  return <VocabularyContext.Provider value={value}>{children}</VocabularyContext.Provider>;
}

type TooltipPlacement = {
  anchor: HTMLElement;
  x: number;
  y: number;
  below: boolean;
  maxHeight: number;
};

/** A fixed portal escapes card/dialog overflow, and follows the anchored word on scroll. */
function ViewportTooltip({
  anchor,
  id,
  children,
}: {
  anchor: HTMLElement | null;
  id: string;
  children: ReactNode;
}) {
  const [placement, setPlacement] = useState<TooltipPlacement | null>(null);
  useEffect(() => {
    if (!anchor) return;
    function align() {
      if (!anchor?.isConnected) {
        setPlacement(null);
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(272, Math.max(160, window.innerWidth - 24));
      const half = width / 2;
      const x = Math.max(
        half + 12,
        Math.min(window.innerWidth - half - 12, rect.left + rect.width / 2),
      );
      const below = rect.top < 180 && window.innerHeight - rect.bottom > rect.top;
      const remaining = below ? window.innerHeight - rect.bottom - 18 : rect.top - 18;
      setPlacement({
        anchor,
        x,
        y: below ? rect.bottom + 8 : rect.top - 8,
        below,
        maxHeight: Math.max(48, Math.min(320, remaining)),
      });
    }
    align();
    window.addEventListener("resize", align);
    window.addEventListener("scroll", align, true);
    return () => {
      window.removeEventListener("resize", align);
      window.removeEventListener("scroll", align, true);
    };
  }, [anchor]);
  if (!placement || placement.anchor !== anchor || typeof document === "undefined") return null;
  return createPortal(
    <span
      id={id}
      role="tooltip"
      data-testid="sentence-word-definition"
      style={{
        position: "fixed",
        top: placement.y,
        left: placement.x,
        maxWidth: "min(17rem, calc(100vw - 24px))",
        maxHeight: placement.maxHeight,
        overflowY: "auto",
      }}
      className={
        "z-[9999] block w-max rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-left text-xs font-normal leading-5 text-white shadow-xl -translate-x-1/2 " +
        (placement.below ? "" : "-translate-y-full")
      }
    >
      {children}
    </span>,
    document.body,
  );
}

type SentenceWordTooltipsProps = {
  text: string;
  focusWord?: TooltipVocabulary | null;
  allowDuringGame?: boolean;
};

/** No hover network calls, AI calls, writes or answer-key disclosures. Explicit-click cache-only GET only. */
export function SentenceWordTooltips(props: SentenceWordTooltipsProps) {
  const { userId } = useContext(VocabularyContext);
  return <AccountSentenceWordTooltips key={userId} {...props} />;
}

function AccountSentenceWordTooltips({
  text,
  focusWord,
  allowDuringGame = false,
}: SentenceWordTooltipsProps) {
  const {
    index: libraryIndex,
    enabled,
    userId,
    allowPoolLookup,
    allowDictionaryLookup,
  } = useContext(VocabularyContext);
  const [poolLookup, setPoolLookup] = useState<Record<string, CachedTooltip>>({});
  const [loadingWord, setLoadingWord] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => () => activeRequest.current?.abort(), []);
  function loadFromPool(key: string) {
    if (
      !userId ||
      (!allowPoolLookup && !allowDictionaryLookup && !allowDuringGame) ||
      loadingWord ||
      (poolLookup[key] && poolLookup[key].status !== "error")
    )
      return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoadingWord(key);
    const load = async (): Promise<CachedTooltip> => {
      try {
        if (allowPoolLookup) {
          const result = await inspectFromPool({ word: key }, userId, controller.signal);
          if (result.status !== "missing") return tooltipFromInspector(result);
        }
      } catch (error) {
        // The independent dictionary endpoint repeats auth and active-assessment checks.
        // Never fallback through an authorization failure or an explicit game denial.
        if (!(error instanceof ApiError) || error.status < 500) throw error;
      }
      return tooltipFromOpenDictionary(
        await lookupOpenTurkishDictionary(key, userId, controller.signal),
      );
    };
    void load()
      .then((result) => {
        if (!controller.signal.aborted) setPoolLookup((prev) => ({ ...prev, [key]: result }));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setPoolLookup((prev) => ({ ...prev, [key]: { status: "error" } }));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingWord(null);
      });
  }
  // A selected lemma/POS is an exact sense. Other senses from a full WordEntry
  // must never leak into that sense-specific tooltip (Approach Noun vs Verb).
  const fallbackIndex = useMemo(
    () => buildVocabularyIndex(focusWord ? [{ ...focusWord, senses: [] }] : []),
    [focusWord],
  );
  const parts = useMemo(() => splitSentenceWords(text), [text]);
  const id = useId().replace(/:/g, "");
  const [active, setActive] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const [activeAnchor, setActiveAnchor] = useState<HTMLElement | null>(null);

  if (!enabled && !allowDuringGame) {
    const focus = focusWord?.word.toLocaleLowerCase("en");
    return (
      <>
        {parts.map((part) =>
          part.kind === "word" && focus && normalizeTooltipWord(part.text) === focus ? (
            <strong key={part.offset} className="font-bold italic">
              {part.text}
            </strong>
          ) : (
            <span key={part.offset}>{part.text}</span>
          ),
        )}
      </>
    );
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape bubbles from the native word buttons and the portaled source links.
    <span
      data-testid="english-sentence-tooltips"
      lang="en"
      onKeyDown={(event) => {
        if (event.key === "Escape" && active !== null) {
          event.preventDefault();
          event.stopPropagation(); // A focused tooltip closes before its parent modal/dialog.
          if (event.target instanceof HTMLElement) event.target.blur();
          setActive(null);
          setPinned(false);
        }
      }}
    >
      {parts.map((part) => {
        if (part.kind !== "word") return <span key={part.offset}>{part.text}</span>;
        const local = matchVocabulary(part.text, libraryIndex);
        const fallback = matchVocabulary(part.text, fallbackIndex);
        // An explicit Inspector/sense selection takes priority over a different personal-library sense.
        // Only the focused lemma uses this override; surrounding words still use the library.
        const isFocus = Boolean(focusWord && fallback.length > 0);
        const matches = isFocus ? fallback : local;
        const key = normalizeTooltipWord(part.text);
        const localMeanings = matches
          .flatMap(tooltipMeanings)
          .filter((v, i, all) => all.indexOf(v) === i)
          .slice(0, 4);
        const needsGloss = localMeanings.length === 0;
        const cached = needsGloss ? poolLookup[key] : undefined;
        const pooledWord = cached?.status === "ready" ? cached.word : undefined;
        const main = pooledWord ?? matches[0];
        const meanings = pooledWord ? tooltipMeanings(pooledWord) : localMeanings;
        const show = active === part.offset;
        const tooltipId = `${id}-tip-${part.offset}`;
        const description = meanings.length
          ? meanings.join(" · ")
          : cached?.status === "choices"
            ? cached.meanings.join(" · ")
            : cached?.status === "missing"
              ? "Güvenilir kaynaklarda Türkçe karşılık bulunamadı"
              : cached?.status === "error"
                ? "Sözlük şu anda kullanılamıyor"
                : loadingWord === key
                  ? "Ortak havuzda aranıyor…"
                  : "Bu kelimenin Türkçe anlamı henüz hazır değil";
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: This wrapper tracks the combined hover area of the native button and its tooltip.
          <span
            key={part.offset}
            className="relative inline"
            onMouseLeave={() => {
              if (!pinned) setActive(null);
            }}
          >
            <button
              type="button"
              data-testid="sentence-word"
              data-word={normalizeTooltipWord(part.text)}
              aria-label={`${part.text}: ${description}`}
              aria-describedby={show ? tooltipId : undefined}
              aria-expanded={show && pinned}
              onMouseEnter={(event) => {
                if (!pinned) {
                  setActiveAnchor(event.currentTarget);
                  setActive(part.offset);
                }
              }}
              onFocus={(event) => {
                setActiveAnchor(event.currentTarget);
                setActive(part.offset);
              }}
              onBlur={() => {
                if (!pinned) setActive(null);
              }}
              onClick={(event) => {
                if (show && pinned) {
                  setActive(null);
                  setPinned(false);
                } else {
                  setActiveAnchor(event.currentTarget);
                  setActive(part.offset);
                  setPinned(true);
                  if (
                    needsGloss &&
                    (!cached || cached.status === "error") &&
                    (allowPoolLookup || allowDictionaryLookup || allowDuringGame)
                  )
                    loadFromPool(key);
                }
              }}
              className="cursor-help rounded-sm border-b border-dotted border-current/50 bg-transparent p-0 text-inherit underline-offset-2 hover:border-atlas-blue hover:text-atlas-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-atlas-blue"
            >
              {isFocus ? <strong className="font-bold italic">{part.text}</strong> : part.text}
            </button>
            {show && (
              <ViewportTooltip anchor={activeAnchor} id={tooltipId}>
                <span className="block font-semibold capitalize">{main?.word ?? part.text}</span>
                {main && (
                  <span className="block text-slate-300">
                    {main.partOfSpeech}
                    {main.cefr && main.cefr !== "Belirtilmedi" ? ` · ${main.cefr}` : ""}
                  </span>
                )}
                <span className="mt-1 block">{description}</span>
                {main?.pronunciationUk && (
                  <span className="block text-slate-300">UK {main.pronunciationUk}</span>
                )}
                {main?.pronunciationUs && (
                  <span className="block text-slate-300">US {main.pronunciationUs}</span>
                )}
                {cached?.status === "ready" && cached.source === "pool" && (
                  <span className="block text-slate-300">Kaynak: doğrulanmış ortak sözlük</span>
                )}
                {cached && "attribution" in cached && cached.attribution && (
                  <span className="block text-amber-200">
                    Dış sözlükteki olası anlam; cümlenin bağlamı doğrulanmadı.
                  </span>
                )}
                {cached && "attribution" in cached && cached.attribution && (
                  <span className="mt-2 block text-slate-300">
                    <a
                      href={cached.attribution.url}
                      rel="noopener noreferrer"
                      target="_blank"
                      className="underline"
                    >
                      Wiktionary
                    </a>{" "}
                    ·{" "}
                    <a
                      href={cached.attribution.licenseUrl}
                      rel="noopener noreferrer"
                      target="_blank"
                      className="underline"
                    >
                      CC BY-SA 4.0
                    </a>{" "}
                    ·{" "}
                    {cached.attribution.provider === "Wiktapi / Turkish Wiktionary" ? (
                      <a
                        href="https://api.wiktapi.dev"
                        rel="noopener noreferrer"
                        target="_blank"
                        className="underline"
                      >
                        Wiktapi
                      </a>
                    ) : (
                      <a
                        href="https://freedictionaryapi.com"
                        rel="noopener noreferrer"
                        target="_blank"
                        className="underline"
                      >
                        FreeDictionaryAPI.com
                      </a>
                    )}
                  </span>
                )}
                {cached?.status === "choices" && (
                  <span className="block text-slate-300">
                    Birden fazla anlam bulundu. Bağlama uygun karşılığı kontrol et.
                  </span>
                )}
                {!main &&
                  (allowPoolLookup || allowDictionaryLookup || allowDuringGame) &&
                  !cached && (
                    <span className="block text-slate-300">
                      Türkçe sözlükte aramak için kelimeye tıkla.
                    </span>
                  )}
                {!main &&
                  ((!allowPoolLookup && !allowDictionaryLookup && !allowDuringGame) ||
                    cached?.status === "missing") && (
                    <span className="block text-slate-300">
                      Güvenilir kaynakta anlam yoksa çeviri uydurulmaz.
                    </span>
                  )}
              </ViewportTooltip>
            )}
          </span>
        );
      })}
    </span>
  );
}

/** Only English prose. Do not tokenize Turkish replies, URLs, code or raw markdown links. */
export function EnglishChatSentenceTooltips({ text }: { text: string }) {
  const segments = useMemo(() => splitChatSentenceSegments(text), [text]);
  return (
    <>
      {withOccurrenceKeys(segments, (segment) => segment.text).map(({ item: segment, key }) =>
        segment.english ? (
          <SentenceWordTooltips key={key} text={segment.text} />
        ) : (
          <span key={key}>{segment.text}</span>
        ),
      )}
    </>
  );
}
